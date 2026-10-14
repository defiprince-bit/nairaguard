/** Independent-user count (design.md §4). Pure logic; chain lookups are injected. */

export const INDEPENDENT_CUTOFF = new Date('2026-10-06T00:00:00Z');
export const EXCLUDE_REASONS = ['team', 'test', 'funded_by_us'] as const;
export type ExcludeReason = (typeof EXCLUDE_REASONS)[number];

export interface ChainLookup {
  /** Earliest mainnet activity (any tx, token transfer or internal tx, in or out), or null if none. */
  firstActivityAt(address: string): Promise<Date | null>;
  /** Every address that ever received CELO or tokens from `source` on mainnet (lowercase). */
  recipientsOf(source: string): Promise<Set<string>>;
}

export type Drop = { address: string; reason: string };
export type CountResult = {
  verifiedTotal: number;
  independent: number;
  dropped: number;
  byReason: Record<string, number>;
  drops: Drop[];
  counted: string[];
  cutoff: string;
};

export async function countIndependent(opts: {
  verifiedWallets: string[];
  excluded: { address: string; reason: ExcludeReason }[];
  teamSources: string[]; // deployer, agent (always) — team-reason wallets are added automatically
  lookup: ChainLookup;
  cutoff?: Date;
}): Promise<CountResult> {
  const cutoff = opts.cutoff ?? INDEPENDENT_CUTOFF;
  const wallets = [...new Set(opts.verifiedWallets.map((w) => w.toLowerCase()))];
  const excluded = new Map(opts.excluded.map((e) => [e.address.toLowerCase(), e.reason]));
  const sources = new Set([
    ...opts.teamSources.map((s) => s.toLowerCase()),
    ...opts.excluded.filter((e) => e.reason === 'team').map((e) => e.address.toLowerCase()),
  ]);

  const funded = new Map<string, string>(); // recipient -> source
  for (const s of sources) for (const r of await opts.lookup.recipientsOf(s)) if (!funded.has(r)) funded.set(r, s);

  const drops: Drop[] = [];
  const counted: string[] = [];
  for (const w of wallets) {
    const ex = excluded.get(w);
    if (ex) { drops.push({ address: w, reason: `excluded:${ex}` }); continue; }
    const src = funded.get(w);
    if (src) { drops.push({ address: w, reason: `funded_by_team:${src}` }); continue; }
    const first = await opts.lookup.firstActivityAt(w);
    if (!first) { drops.push({ address: w, reason: 'no_mainnet_activity' }); continue; }
    if (first >= cutoff) { drops.push({ address: w, reason: `first_tx_after_cutoff:${first.toISOString().slice(0, 10)}` }); continue; }
    counted.push(w);
  }
  const byReason: Record<string, number> = {};
  for (const d of drops) { const k = d.reason.split(':')[0]! + (d.reason.startsWith('excluded:') ? `:${d.reason.split(':')[1]}` : ''); byReason[k] = (byReason[k] ?? 0) + 1; }
  return { verifiedTotal: wallets.length, independent: counted.length, dropped: drops.length, byReason, drops, counted, cutoff: cutoff.toISOString() };
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
  return lines.join('\n');
}

type BsTx = { from?: string; to?: string; timeStamp?: string };

/** Read-only Celo mainnet lookups via Blockscout's Etherscan-compatible API. */
export class BlockscoutLookup implements ChainLookup {
  constructor(private readonly base = 'https://celo.blockscout.com/api', private readonly fetchFn: typeof fetch = fetch) {}

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
    const firsts = await Promise.all(['txlist', 'tokentx', 'txlistinternal'].map((a) => this.list(a, address, 1, 1, 'asc')));
    const ts = firsts.flat().map((t) => Number(t.timeStamp)).filter((n) => n > 0);
    return ts.length ? new Date(Math.min(...ts) * 1000) : null;
  }

  async recipientsOf(source: string) {
    const s = source.toLowerCase();
    const out = new Set<string>();
    for (const action of ['txlist', 'tokentx', 'txlistinternal']) {
      for (let page = 1; page <= 50; page++) {
        const rows = await this.list(action, s, page, 1000, 'asc');
        for (const t of rows) if (t.from?.toLowerCase() === s && t.to) out.add(t.to.toLowerCase());
        if (rows.length < 1000) break;
      }
    }
    out.delete(s);
    return out;
  }
}
