/** Independent-user count (design.md §4). Pure logic; chain lookups are injected. */

/** 6 Oct 2026 00:00 WAT. Override with --cutoff or INDEPENDENT_CUTOFF. */
export const INDEPENDENT_CUTOFF = new Date('2026-10-05T23:00:00Z');
export const EXCLUDE_REASONS = ['team', 'test', 'funded_by_us'] as const;
export type ExcludeReason = (typeof EXCLUDE_REASONS)[number];

export interface ChainLookup {
  /** Earliest mainnet activity (any tx, token transfer or internal tx, in or out), or null if none. */
  firstActivityAt(address: string): Promise<Date | null>;
  /** Every address that ever received CELO or tokens from `source` on mainnet (lowercase). */
  recipientsOf(source: string): Promise<Set<string>>;
  /** Every address that ever sent CELO or tokens to `address` on mainnet (lowercase). */
  sendersTo(address: string): Promise<Set<string>>;
}

export type Drop = { address: string; reason: string };
export type CountResult = {
  verifiedTotal: number;
  independent: number;
  dropped: number;
  byReason: Record<string, number>;
  drops: Drop[];
  /** Funded by a wallet the team funded (one hop). Not counted; review by hand. */
  review: Drop[];
  counted: string[];
  /** Intermediaries actually used for a funded_indirect flag, with how many distinct addresses they paid. */
  intermediaries: { address: string; fundedBy: string; fanout: number }[];
  maxFanout: number;
  cutoff: string;
};

/** Default: a team-funded wallet that paid more than this many distinct addresses is not an intermediary. */
export const DEFAULT_MAX_FANOUT = 20;

export async function countIndependent(opts: {
  verifiedWallets: string[];
  excluded: { address: string; reason: ExcludeReason }[];
  teamSources: string[]; // deployer, agent (always) — team-reason wallets are added automatically
  lookup: ChainLookup;
  cutoff?: Date;
  /** Max distinct payees for a wallet to count as an intermediary. */
  maxFanout?: number;
  /** Exchange / on-ramp hot wallets: never intermediaries. */
  allowlist?: string[];
}): Promise<CountResult> {
  const cutoff = opts.cutoff ?? INDEPENDENT_CUTOFF;
  const maxFanout = opts.maxFanout ?? DEFAULT_MAX_FANOUT;
  const allow = new Set((opts.allowlist ?? []).map((x) => x.toLowerCase()));
  const fanout = new Map<string, number>();
  const used = new Map<string, { address: string; fundedBy: string; fanout: number }>();
  /** Team-funded wallet that is not ours, not allowlisted, and paid ≤ maxFanout addresses. */
  const isIntermediary = async (x: string) => {
    if (!funded.has(x) || sources.has(x) || allow.has(x)) return false;
    if (!fanout.has(x)) fanout.set(x, (await opts.lookup.recipientsOf(x)).size);
    return fanout.get(x)! <= maxFanout;
  };
  const wallets = [...new Set(opts.verifiedWallets.map((w) => w.toLowerCase()))];
  const excluded = new Map(opts.excluded.map((e) => [e.address.toLowerCase(), e.reason]));
  const sources = new Set([
    ...opts.teamSources.map((s) => s.toLowerCase()),
    ...opts.excluded.filter((e) => e.reason === 'team').map((e) => e.address.toLowerCase()),
  ]);

  const funded = new Map<string, string>(); // recipient -> source
  for (const s of sources) for (const r of await opts.lookup.recipientsOf(s)) if (!funded.has(r)) funded.set(r, s);

  const drops: Drop[] = [];
  const review: Drop[] = [];
  const counted: string[] = [];
  for (const w of wallets) {
    const ex = excluded.get(w);
    if (ex) { drops.push({ address: w, reason: `excluded:${ex}` }); continue; }
    const src = funded.get(w);
    if (src) { drops.push({ address: w, reason: `funded_by_team:${src}` }); continue; }
    let hop: string | undefined;
    for (const x of await opts.lookup.sendersTo(w)) if (await isIntermediary(x)) { hop = x; break; }
    if (hop) {
      used.set(hop, { address: hop, fundedBy: funded.get(hop)!, fanout: fanout.get(hop)! });
      review.push({ address: w, reason: `funded_indirect:${hop}` });
      continue;
    }
    const first = await opts.lookup.firstActivityAt(w);
    if (!first) { drops.push({ address: w, reason: 'no_mainnet_activity' }); continue; }
    if (first >= cutoff) { drops.push({ address: w, reason: `first_tx_after_cutoff:${first.toISOString().slice(0, 10)}` }); continue; }
    counted.push(w);
  }
  const byReason: Record<string, number> = review.length ? { funded_indirect: review.length } : {};
  for (const d of drops) { const k = d.reason.split(':')[0]! + (d.reason.startsWith('excluded:') ? `:${d.reason.split(':')[1]}` : ''); byReason[k] = (byReason[k] ?? 0) + 1; }
  return { verifiedTotal: wallets.length, independent: counted.length, dropped: drops.length + review.length, byReason, drops, review, counted, intermediaries: [...used.values()], maxFanout, cutoff: cutoff.toISOString() };
}

export function renderTable(r: CountResult): string {
  const lines = [
    `Verified wallets: ${r.verifiedTotal}`,
    `Independent (active on Celo mainnet before ${r.cutoff.slice(0, 10)}): ${r.independent}`,
    `Dropped: ${r.dropped}`,
    ...Object.entries(r.byReason).map(([k, v]) => `  ${k.padEnd(28)} ${v}`),
  ];
  if (r.drops.length) {
    lines.push('', `${'address'.padEnd(44)} reason`, `${'-'.repeat(44)} ${'-'.repeat(30)}`);
    for (const d of r.drops) lines.push(`${d.address.padEnd(44)} ${d.reason}`);
  }
  if (r.review.length) {
    lines.push('', 'Manual review (funded_indirect: received from a wallet the team funded):');
    for (const d of r.review) lines.push(`${d.address.padEnd(44)} via ${d.reason.split(':')[1]}`);
  }
  lines.push('', `Intermediaries used (team-funded, paid out to ≤ ${r.maxFanout} addresses): ${r.intermediaries.length}`);
  for (const i of r.intermediaries) lines.push(`${i.address.padEnd(44)} paid ${i.fanout} addresses, funded by ${i.fundedBy}`);
  return lines.join('\n');
}

type BsTx = { from?: string; to?: string; timeStamp?: string };

/** Read-only Celo mainnet lookups via Blockscout's Etherscan-compatible API. */
export class BlockscoutLookup implements ChainLookup {
  private readonly cache = new Map<string, Promise<BsTx[]>>();
  constructor(
    private readonly base = 'https://celo.blockscout.com/api',
    private readonly fetchFn: typeof fetch = fetch,
    /** Max pages (x1000 rows) per address per list; caps calls for busy wallets. */
    private readonly maxPages = 5,
  ) {}

  /** All rows (capped) for one action/address, cached so each list is fetched once per run. */
  private all(action: string, address: string): Promise<BsTx[]> {
    const k = `${action}:${address.toLowerCase()}`;
    let p = this.cache.get(k);
    if (!p) {
      p = (async () => {
        const out: BsTx[] = [];
        for (let page = 1; page <= this.maxPages; page++) {
          const rows = await this.list(action, address.toLowerCase(), page, 1000, 'asc');
          out.push(...rows);
          if (rows.length < 1000) break;
        }
        return out;
      })();
      this.cache.set(k, p);
    }
    return p;
  }

  private async list(action: string, address: string, page: number, offset: number, sort: 'asc' | 'desc'): Promise<BsTx[]> {
    const u = `${this.base}?module=account&action=${action}&address=${address}&sort=${sort}&page=${page}&offset=${offset}`;
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchFn(u);
      if (res.ok) {
        const j = (await res.json()) as { status: string; message: string; result: BsTx[] | string };
        if (Array.isArray(j.result)) return j.result;
        if (/no (transactions|token transfers|internal)/i.test(j.message) || j.status === '0') return [];
      }
      if (attempt >= 3) throw new Error(`blockscout ${action} ${address}: HTTP ${res.status}`);
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }

  async firstActivityAt(address: string) {
    const lists = await Promise.all(ACTIONS.map((a) => this.all(a, address)));
    const ts = lists.flat().map((t) => Number(t.timeStamp)).filter((n) => n > 0);
    return ts.length ? new Date(Math.min(...ts) * 1000) : null;
  }

  async recipientsOf(source: string) {
    const s = source.toLowerCase();
    const out = new Set<string>();
    for (const a of ACTIONS) for (const t of await this.all(a, s)) if (t.from?.toLowerCase() === s && t.to) out.add(t.to.toLowerCase());
    out.delete(s);
    return out;
  }

  async sendersTo(address: string) {
    const w = address.toLowerCase();
    const out = new Set<string>();
    for (const a of ACTIONS) for (const t of await this.all(a, w)) if (t.to?.toLowerCase() === w && t.from) out.add(t.from.toLowerCase());
    out.delete(w);
    return out;
  }
}

const ACTIONS = ['txlist', 'tokentx', 'txlistinternal'] as const;
