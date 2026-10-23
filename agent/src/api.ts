import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { type Client, formatUnits, isAddress } from 'viem';
import { createSiweMessage, parseSiweMessage, verifySiweMessage } from 'viem/siwe';
import type { Db, RfqOutcome } from './db.js';
import type { FeedReading } from './feed.js';
import type { VaultState } from './loop.js';
import { computePnl, pnlBasis } from './pnl.js';
import { STATS_DEFAULT_CHAIN_ID } from './config.js';

import { WAITLIST_SOURCES, normaliseSource } from './waitlistSources.js';
import { friendlyReason } from './reasons.js';
import { unsubscribe as doUnsubscribe, verifyUnsubscribeToken } from './campaign.js';

export { WAITLIST_SOURCES, normaliseSource };

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

const NONCE_TTL_MS = 10 * 60_000;

export type ApiDeps = {
  db: Db;
  agentAddress: `0x${string}`;
  erc8004Id?: string;
  tokens: { cngn: `0x${string}`; usdt: `0x${string}` };
  /** Token decimals (read on-chain at startup). Default 18 for legacy mocks. */
  decimals?: { cngn: number; usdt: number };
  /** Reference rate the vault uses (Chainlink NGN/USD or owner fallback). */
  readFeed?: () => Promise<FeedReading>;
  /** Live on-chain read for limits; optional (falls back to last logged quote for balances). */
  readState?: (vault: `0x${string}`) => Promise<VaultState>;
  /** SIWE expectations. */
  siwe: { domain: string; uri: string; chainId: number; client: Client };
  /** Agent considered unhealthy when its last ok run is older than this. */
  staleAfterMs?: number;
  /** Chain whose rows this API reports (P&L, volume, stats default). Defaults to mainnet 42220. */
  chainId?: number;
  /** HMAC secret for signed unsubscribe links (UNSUBSCRIBE_SECRET). Route answers 503 when unset. */
  unsubscribeSecret?: string;
  now?: () => Date;
};

export type ApiRequest = { method: string; url: string; body?: unknown };
export type ApiResponse = { status: number; body: unknown };

type Money = { token: 'cNGN' | 'USDT'; amount: string; amountNgn: string; amountUsd: string; rate: string; rateAt: string };

function money(token: 'cNGN' | 'USDT', amount: string, rate: number, rateAt: Date | string, dec = 18): Money {
  const units = Number(formatUnits(BigInt(amount), dec));
  const ngn = token === 'cNGN' ? units : units * rate;
  return {
    token, amount, amountNgn: ngn.toFixed(2), amountUsd: (ngn / rate).toFixed(2), rate: String(rate),
    rateAt: new Date(rateAt).toISOString(),
  };
}

const iso = (d: Date | string) => new Date(d).toISOString();

/**
 * Actual fill rate (cNGN per 1 USD₮) from the Swapped event's amountIn/amountOut, normalised by decimals,
 * whichever direction the trade went. Null when either amount is zero.
 */
export function fillRate(
  ngnIsIn: boolean, amountIn: bigint, amountOut: bigint, dec: { cngn: number; usdt: number },
): string | null {
  const ngn = ngnIsIn ? amountIn : amountOut;
  const usd = ngnIsIn ? amountOut : amountIn;
  if (ngn <= 0n || usd <= 0n) return null;
  return (Number(formatUnits(ngn, dec.cngn)) / Number(formatUnits(usd, dec.usdt))).toFixed(2);
}
const json = (status: number, body: unknown): ApiResponse => ({ status, body });

export function createApi(d: ApiDeps) {
  const now = () => d.now?.() ?? new Date();
  const chainId = d.chainId ?? STATS_DEFAULT_CHAIN_ID;
  const decOf = (t: 'cNGN' | 'USDT') => (t === 'cNGN' ? d.decimals?.cngn : d.decimals?.usdt) ?? 18;
  const pnlDec = { ngn: decOf('cNGN'), usd: decOf('USDT') };
  const m = (t: 'cNGN' | 'USDT', amount: string, rate: number, at: Date | string) => money(t, amount, rate, at, decOf(t));
  const sym = (a: string | null): 'cNGN' | 'USDT' =>
    a?.toLowerCase() === d.tokens.cngn.toLowerCase() ? 'cNGN' : 'USDT';

  async function latestQuote(vault: string) {
    const r = await d.db.query<{ rate: string; ngn_balance: string; usd_balance: string; created_at: string }>(
      'SELECT * FROM quotes WHERE vault=$1 AND chain_id=$2 ORDER BY created_at DESC, id DESC LIMIT 1', [vault, chainId]);
    return r.rows[0];
  }

  async function balances(vault: string) {
    const q = await latestQuote(vault);
    const st = d.readState ? await d.readState(vault as `0x${string}`).catch(() => undefined) : undefined;
    if (!q && !st) return json(404, { error: 'unknown_vault' });
    // No agent quote yet (new vault): fall back to the onchain Chainlink reference rate so ₦ values never read 0.
    const feed = !q && d.readFeed ? await d.readFeed().catch(() => undefined) : undefined;
    const rate = Number(q?.rate ?? feed?.rateNgnPerUsd ?? 0);
    const rateAt = q?.created_at ?? (feed ? iso(feed.updatedAt) : now());
    const ngn = st?.ngnBalance.toString() ?? q!.ngn_balance;
    const usd = st?.usdBalance.toString() ?? q!.usd_balance;
    if (!rate) return json(503, { error: 'no_rate_yet' });
    const bal = [m('cNGN', ngn, rate, rateAt), m('USDT', usd, rate, rateAt)];
    const total = Number(bal[0]!.amountNgn) + Number(bal[1]!.amountNgn);
    // Net of the owner's deposits/withdrawals (vault_flows), so adding money is never shown as profit.
    const { basis: b, since } = await pnlBasis(d.db, vault, d.tokens, chainId);
    const p = b ? computePnl(b, ngn, usd, rate, pnlDec) : undefined;
    return json(200, { chainId: d.chainId ?? null,
      balances: bal,
      ngnShareBps: total > 0 ? Math.round((Number(bal[0]!.amountNgn) / total) * 10_000) : 0,
      targetNgnBps: st?.limits.targetNgnBps ?? null,
      // No baseline yet → P&L unknown, not zero.
      pnlNgn: p ? p.pnlNgn.toFixed(2) : null,
      pnlUsd: p ? p.pnlUsd.toFixed(2) : null,
      pnlSince: b && since ? iso(since) : null,
      volumeUsd: await volumeUsd(vault),
      lastCheckedAt: await lastCheckedAt(vault),
    });
  }

  /** Last agent check of this vault (any outcome), or null if never checked. */
  async function lastCheckedAt(vault: string): Promise<string | null> {
    const r = await d.db.query<{ t: string | Date | null }>(
      'SELECT max(ran_at) AS t FROM agent_runs WHERE lower(vault)=$1', [vault]);
    return r.rows[0]?.t ? iso(r.rows[0].t) : null;
  }

  /** Traded volume in USD from actual amounts: the USD₮ leg of each confirmed swap (amount_out when USD₮ is received). */
  async function volumeUsd(vault: string): Promise<string> {
    const r = await d.db.query<{ token_in: string; amount_in: string | null; amount_out: string | null }>(
      `SELECT token_in, amount_in, amount_out FROM activity WHERE lower(vault)=$1 AND chain_id=$2 AND kind='swap' AND status='confirmed'`, [vault, chainId]);
    let total = 0n;
    for (const a of r.rows) {
      const usdLeg = a.token_in?.toLowerCase() === d.tokens.usdt.toLowerCase() ? a.amount_in : a.amount_out;
      if (usdLeg) total += BigInt(usdLeg);
    }
    return Number(formatUnits(total, decOf('USDT'))).toFixed(2);
  }

  async function status(vault: string) {
    const r = await d.db.query<{ ran_at: string; ok: boolean; error: string | null }>(
      'SELECT ran_at, ok, error FROM agent_runs WHERE lower(vault)=$1 ORDER BY ran_at DESC, id DESC LIMIT 1', [vault]);
    const last = r.rows[0];
    const feed = d.readFeed ? await d.readFeed().catch(() => undefined) : undefined;
    const st = d.readState ? await d.readState(vault as `0x${string}`).catch(() => undefined) : undefined;
    // paused: "owner" when the owner paused, "stale_price" when the reference rate is too old (vault reverts StalePrice).
    const lo = await d.db.query<{ outcome: string; requested_at: string }>(
      'SELECT outcome, requested_at FROM textile_quotes WHERE lower(vault)=$1 ORDER BY requested_at DESC, id DESC LIMIT 1', [vault]);
    const lastQ = lo.rows[0];
    const paused = st?.paused ? 'owner' : feed && feed.stale ? 'stale_price' : null;
    return json(200, { chainId: d.chainId ?? null,
      vault, lastCheckedAt: last ? iso(last.ran_at) : null, ok: last ? last.ok : null,
      // Official (Chainlink) ₦ per $1, for reference only; the tradable rate comes from RFQ quotes.
      feedRate: feed?.rateNgnPerUsd != null ? feed.rateNgnPerUsd.toFixed(2) : null,
      feedUpdatedAt: feed ? iso(feed.updatedAt) : null,
      paused,
      lastOutcome: (lastQ?.outcome ?? null) as RfqOutcome | null,
      lastOutcomeAt: lastQ ? iso(lastQ.requested_at) : null,
    });
  }

  /**
   * Keyset paging, newest first, over two sources: activity rows (src 'a') and no-trade RFQ checks from
   * textile_quotes (src 'q'; quotes that sent a tx already have an activity row). Consecutive identical
   * no-trade outcomes collapse into one item keyed by its first occurrence, so the key never changes as the
   * run grows; price_moved on an approved trade (approval_id set) always stays its own row.
   * Cursor = base64url(JSON [firstAt text, id, src]); legacy [createdAt, id] cursors are read as src 'a'.
   */
  async function activity(vault: string, q?: URLSearchParams) {
    const limit = Math.min(Math.max(Number(q?.get('limit') ?? 50) || 50, 1), 100);
    let after: [string, string, string] | null = null;
    const c = q?.get('cursor');
    if (c) {
      try {
        const v = JSON.parse(Buffer.from(c, 'base64url').toString('utf8'));
        if (!Array.isArray(v) || typeof v[0] !== 'string' || !/^\d+$/.test(String(v[1]))) throw new Error();
        const src = v[2] ?? 'a';
        if (src !== 'a' && src !== 'q') throw new Error();
        after = [v[0], String(v[1]), src];
      } catch {
        return json(400, { error: 'cursor_invalid' });
      }
    }
    const r = await d.db.query<{ src: 'a' | 'q'; id: string; last_id: string; first_at: string; last_at: string; n: number; cur_at: string }>(
      `WITH s AS (
         SELECT created_at AS at, 'a'::text AS src, id,
           CASE WHEN kind='noop' THEN 'noop:' || check_code END AS outcome, NULL::text AS approval_id FROM activity
         WHERE lower(vault)=$1 AND (kind IN ('swap','deposit','withdraw') OR (kind='propose' AND status='rejected')
           OR (kind='noop' AND check_code IS NOT NULL))
         UNION ALL
         SELECT requested_at, 'q', id, outcome, approval_id FROM textile_quotes
         WHERE lower(vault)=$1 AND outcome <> 'filled' AND tx_hash IS NULL
       ), l AS (
         SELECT *,
           ((src='q' AND NOT (outcome='price_moved' AND approval_id IS NOT NULL)) OR (src='a' AND outcome IS NOT NULL)) AS collapsible,
           lag(src) OVER w AS p_src, lag(outcome) OVER w AS p_outcome,
           lag(outcome='price_moved' AND approval_id IS NOT NULL) OVER w AS p_pinned
         FROM s WINDOW w AS (ORDER BY at, src, id)
       ), g AS (
         SELECT *, sum(CASE WHEN collapsible AND p_src=src AND p_outcome=outcome AND NOT p_pinned THEN 0 ELSE 1 END)
           OVER (ORDER BY at, src, id) AS grp FROM l
       ), agg AS (
         SELECT min(src) AS src, (array_agg(id ORDER BY at, id))[1] AS id, (array_agg(id ORDER BY at DESC, id DESC))[1] AS last_id,
           min(at) AS first_at, max(at) AS last_at,
           count(*)::int AS n FROM g GROUP BY grp
       )
       SELECT *, first_at::text AS cur_at FROM agg
       WHERE $2::timestamptz IS NULL OR (first_at, src, id) < ($2::timestamptz, $4::text, $3::bigint)
       ORDER BY first_at DESC, src DESC, id DESC LIMIT $5`,
      [vault, after?.[0] ?? null, after?.[1] ?? '0', after?.[2] ?? 'a', limit + 1]);
    const page = r.rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor = r.rows.length > limit && last
      ? Buffer.from(JSON.stringify([last.cur_at, String(last.id), last.src])).toString('base64url') : null;
    const ids = (src: 'a' | 'q') => page.filter((x) => x.src === src).flatMap((x) => [String(x.id), String(x.last_id)]);
    const aRows = new Map<string, Record<string, string | null>>();
    const qRows = new Map<string, Record<string, string | null>>();
    if (ids('a').length) {
      for (const x of (await d.db.query<Record<string, string | null>>('SELECT * FROM activity WHERE id = ANY($1::bigint[])', [ids('a')])).rows) aRows.set(String(x.id), x);
    }
    if (ids('q').length) {
      for (const x of (await d.db.query<Record<string, string | null>>('SELECT * FROM textile_quotes WHERE id = ANY($1::bigint[])', [ids('q')])).rows) qRows.set(String(x.id), x);
    }
    return json(200, { chainId: d.chainId ?? null,
      nextCursor,
      items: page.map((g) => {
        if (g.src === 'q') {
          const x = qRows.get(String(g.id))!;
          return {
            id: `q${g.id}`, kind: 'check' as const, outcome: x.outcome as RfqOutcome, reason: friendlyReason(x.outcome, x.outcome_reason),
            at: iso(g.first_at), createdAt: iso(g.first_at),
            count: g.n, firstAt: iso(g.first_at), lastAt: iso(g.last_at),
            approvalId: x.approval_id ?? null,
            rateNgnPerUsd: x.rate_ngn_per_usd ?? null, feedRateNgnPerUsd: x.feed_rate_ngn_per_usd ?? null,
            sizeUsd: x.size_usd ?? null, venue: x.venue ?? null,
          };
        }
        const a = aRows.get(String(g.id))!;
        if (a.kind === 'noop') {
          // "Checked, no trade needed": written only when the reason changes (see insertCheck); consecutive checks
          // with the same code collapse like RFQ outcomes (keyed by the first, latest reason shown).
          const latest = aRows.get(String(g.last_id)) ?? a;
          return {
            id: String(a.id), kind: 'check' as const, outcome: null, code: a.check_code, reason: latest.reason,
            status: 'skipped', at: iso(g.first_at), createdAt: iso(g.first_at),
            count: g.n, firstAt: iso(g.first_at), lastAt: iso(g.last_at),
          };
        }
        const rate = Number(a.rate ?? 0);
        const at = a.created_at!;
        const outAmt = a.amount_out; // actual received; null for legacy rows (never minOut)
        const outcome: RfqOutcome | null = a.kind === 'swap'
          ? (a.status === 'confirmed' ? 'filled' : a.status === 'failed' ? 'expired' : null)
          : a.kind === 'propose' ? 'declined' : null;
        return {
          id: String(a.id), kind: a.kind === 'propose' ? 'swap' : a.kind, reason: a.reason, txHash: a.tx_hash, status: a.status,
          at: iso(at), createdAt: iso(at), outcome,
          in: a.amount_in && rate ? m(sym(a.token_in), a.amount_in, rate, at) : undefined,
          out: outAmt && rate ? m(sym(a.token_out), outAmt, rate, at) : undefined,
          // Actual tokenOut received (base units), from the vault's Swapped event. Null for legacy rows.
          amountOut: outAmt ?? null,
          feeNgn: a.fee_ngn, pnlNgn: a.pnl_ngn,
          // From the vault's Swapped.target via the factory's pair label; null for legacy rows.
          venue: a.kind === 'swap' ? a.venue ?? null : null,
        };
      }),
    });
  }

  /** Executed approvals only: actual fill from the Swapped event (amountIn/amountOut), never the quote. */
  function fill(a: Record<string, string>) {
    if (a.status !== 'executed' || !a.executed_amount_in || !a.executed_amount_out) return { fillRateNgnPerUsd: null, amountOut: null };
    const ngnIn = sym(a.token_in) === 'cNGN';
    return {
      fillRateNgnPerUsd: fillRate(ngnIn, BigInt(a.executed_amount_in), BigInt(a.executed_amount_out), { cngn: decOf('cNGN'), usdt: decOf('USDT') }),
      amountOut: a.executed_amount_out,
    };
  }

  async function approvals(vault: string) {
    const r = await d.db.query<Record<string, string>>(
      `SELECT a.*, (SELECT rate FROM quotes q WHERE q.vault=lower(a.vault) AND q.chain_id=a.chain_id ORDER BY q.created_at DESC LIMIT 1) AS rate
       FROM approvals a WHERE lower(a.vault)=$1
         AND (a.status IN ('pending','approved','executed','rejected','expired'))
       ORDER BY a.created_at DESC LIMIT 100`,
      [vault]);
    return json(200, { chainId: d.chainId ?? null,
      items: r.rows.map((a) => {
        const rate = Number(a.rate ?? 0);
        const token = (t: string, amount: string) =>
          rate > 0 ? m(sym(t), amount, rate, a.created_at) : { token: sym(t), amount, amountNgn: null, amountUsd: null, rate: null, rateAt: null };
        const t = now().getTime();
        // Pending: owner must approve before the proposal deadline. Approved: agent must run it before the window ends.
        const deadline = a.status === 'approved' && a.window_expires_at ? a.window_expires_at : a.expires_at;
        const st = (a.status === 'pending' || a.status === 'approved') && new Date(deadline!).getTime() <= t ? 'expired' : a.status;
        return {
          id: a.onchain_id, reason: a.reason, expiresAt: iso(deadline!),
          status: st as 'pending' | 'approved' | 'executed' | 'expired' | 'rejected',
          approvedAt: a.approved_at ? iso(a.approved_at) : null,
          // User's floor in tokenOut base units: the agent only trades at this or better.
          approvedMinOut: a.min_out,
          executedTx: a.executed_tx ?? null,
          ...fill(a),
          rejectedAt: a.rejected_at ? iso(a.rejected_at) : null,
          rateNgnPerUsd: rate > 0 ? String(rate) : null,
          rateNote: rate > 0 ? undefined : 'rate unavailable',
          in: token(a.token_in, a.amount_in),
          minOut: token(a.token_out, a.min_out),
        };
      }),
    });
  }

  /** RFQ stats for the submission / build-in-public posts: every quote requested, quoted and filled. */
  async function quoteStats(q: URLSearchParams) {
    const since = q.get('since');
    if (since && Number.isNaN(Date.parse(since))) return json(400, { error: 'since_invalid' });
    const sinceIso = since ? new Date(since).toISOString() : '1970-01-01T00:00:00Z';
    const cq = q.get('chainId');
    if (cq != null && !/^[1-9][0-9]{0,9}$/.test(cq)) return json(400, { error: 'chainId_invalid' });
    const statsChain = cq != null ? Number(cq) : STATS_DEFAULT_CHAIN_ID;
    const agg = `count(*)::int AS requested,
        count(*) FILTER (WHERE quoted)::int AS quoted,
        count(*) FILTER (WHERE outcome='filled')::int AS filled,
        count(*) FILTER (WHERE outcome='expired')::int AS expired,
        count(*) FILTER (WHERE outcome='declined')::int AS declined,
        count(*) FILTER (WHERE outcome='no_quote')::int AS no_quote,
        count(*) FILTER (WHERE outcome='price_moved')::int AS price_moved,
        COALESCE(sum(size_usd),0)::float8 AS requested_usd,
        COALESCE(sum(size_usd) FILTER (WHERE quoted),0)::float8 AS quoted_usd,
        COALESCE(sum(size_usd) FILTER (WHERE outcome='filled'),0)::float8 AS filled_usd,
        avg(rate_ngn_per_usd)::float8 AS avg_rate,
        avg(feed_rate_ngn_per_usd)::float8 AS avg_feed_rate,
        avg((rate_ngn_per_usd - feed_rate_ngn_per_usd) / feed_rate_ngn_per_usd * 10000)
          FILTER (WHERE quoted AND feed_rate_ngn_per_usd > 0)::float8 AS avg_gap_bps`;
    const shape = (r: Record<string, number | null>) => ({
      requested: r.requested, quoted: r.quoted, filled: r.filled,
      outcomes: { filled: r.filled, expired: r.expired, declined: r.declined, no_quote: r.no_quote, price_moved: r.price_moved },
      requestedUsd: Number(r.requested_usd ?? 0).toFixed(2), quotedUsd: Number(r.quoted_usd ?? 0).toFixed(2),
      filledUsd: Number(r.filled_usd ?? 0).toFixed(2),
      avgRateNgnPerUsd: r.avg_rate != null ? Number(r.avg_rate).toFixed(2) : null,
      avgFeedRateNgnPerUsd: r.avg_feed_rate != null ? Number(r.avg_feed_rate).toFixed(2) : null,
      // Market (quote) vs official (Chainlink) rate, bps. Positive = market gives more ₦ per $.
      avgGapBps: r.avg_gap_bps != null ? Math.round(Number(r.avg_gap_bps)) : null,
    });
    const tot = await d.db.query<Record<string, number | null>>(`SELECT ${agg} FROM textile_quotes WHERE requested_at >= $1 AND chain_id = $2`, [sinceIso, statsChain]);
    const wk = await d.db.query<Record<string, number | null> & { week: string | Date }>(
      `SELECT date_trunc('week', requested_at) AS week, ${agg} FROM textile_quotes WHERE requested_at >= $1 AND chain_id = $2
       GROUP BY 1 ORDER BY 1 DESC LIMIT 26`, [sinceIso, statsChain]);
    return json(200, {
      chainId: statsChain,
      since: since ? sinceIso : null,
      ...shape(tot.rows[0]!),
      weekly: wk.rows.map((r) => ({ weekStart: iso(r.week), ...shape(r) })),
    });
  }

  async function limits(vault: string) {
    if (!d.readState) return json(503, { error: 'chain_unavailable' });
    const st = await d.readState(vault as `0x${string}`).catch((e: Error) => e);
    if (st instanceof Error) return st.message === 'unknown vault' ? json(404, { error: 'unknown_vault' }) : json(503, { error: 'chain_unavailable' });
    const l = st.limits;
    return json(200, { chainId: d.chainId ?? null,
      maxTradeUsd: l.maxTradeUsd.toString(), maxDailyUsd: l.maxDailyUsd.toString(),
      approvalThresholdUsd: l.approvalThresholdUsd.toString(), maxSlippageBps: l.maxSlippageBps, targetNgnBps: l.targetNgnBps,
    });
  }

  async function agent() {
    const r = await d.db.query<{ ran_at: string; ok: boolean }>('SELECT ran_at, ok FROM agent_runs ORDER BY ran_at DESC LIMIT 1');
    const last = r.rows[0];
    const stale = d.staleAfterMs ?? 15 * 60_000;
    return json(200, { chainId: d.chainId ?? null,
      address: d.agentAddress, erc8004Id: d.erc8004Id,
      lastRunAt: last ? iso(last.ran_at) : null,
      healthy: !!last && last.ok && now().getTime() - new Date(last.ran_at).getTime() < stale,
    });
  }

  /** Issue a one-time SIWE nonce + the exact message fields the wallet must sign. */
  async function nonce(address: string | null) {
    const n = randomBytes(16).toString('hex');
    const issuedAt = now();
    const expirationTime = new Date(issuedAt.getTime() + NONCE_TTL_MS);
    await d.db.query('INSERT INTO waitlist_nonces (nonce, expires_at) VALUES ($1,$2)', [n, expirationTime.toISOString()]);
    const message = address && isAddress(address)
      ? createSiweMessage({
          address, chainId: d.siwe.chainId, domain: d.siwe.domain, uri: d.siwe.uri, version: '1', nonce: n,
          issuedAt, expirationTime, statement: 'Join the NairaGuard waitlist with this wallet.',
        })
      : undefined;
    return json(200, { nonce: n, expiresAt: expirationTime.toISOString(), message });
  }

  /** Join without signing: always stored unverified. */
  async function waitlist(body: unknown, source: string) {
    if (!body || typeof body !== 'object') return json(400, { ok: false, error: 'invalid_body' });
    const b = body as Record<string, unknown>;
    // Email is required; wallet is optional (prefilled from MiniPay / a connected wallet when available).
    const contact = typeof b.email === 'string' ? b.email.trim() : typeof b.contact === 'string' ? b.contact.trim() : '';
    if (!contact) return json(400, { ok: false, error: 'email_required' });
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
    if (!isEmail) return json(400, { ok: false, error: 'email_invalid' });
    if (b.consent !== true) return json(400, { ok: false, error: 'consent_required' });
    let wallet: string | null = null;
    if (b.wallet != null && b.wallet !== '') {
      if (typeof b.wallet !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(b.wallet.trim())) return json(400, { ok: false, error: 'wallet_invalid' });
      wallet = b.wallet.trim().toLowerCase();
    }
    // Any client-sent verified flag is ignored (design.md §4).
    // Secret returned once; only its hash is stored. Required to verify this signup.
    const signupToken = randomBytes(32).toString('hex');
    try {
      await d.db.query(
        `INSERT INTO waitlist (email, phone, wallet_address, verified, from_minipay, source, consent, signup_token_hash)
         VALUES ($1,$2,$3,false,$4,$5,true,$6)`,
        [contact, null, wallet, b.fromMiniPay === true, source, hashToken(signupToken)]);
      return json(200, { ok: true, signupToken, verified: false });
    } catch (e) {
      if (/unique|duplicate/i.test((e as Error).message)) return json(409, { ok: false, error: 'already_joined' });
      throw e;
    }
  }

  /** SIWE: prove wallet ownership for an existing signup; only then verified = true. */
  async function verify(body: unknown) {
    const b = (body ?? {}) as Record<string, unknown>;
    if (typeof b.signupToken !== 'string' || !/^[0-9a-f]{64}$/.test(b.signupToken)) {
      return json(400, { ok: false, error: 'signup_token_required' });
    }
    const tokenHash = hashToken(b.signupToken);
    if (typeof b.message !== 'string' || typeof b.signature !== 'string') return json(400, { ok: false, error: 'siwe_required' });
    let parsed;
    try { parsed = parseSiweMessage(b.message); } catch { return json(400, { ok: false, error: 'siwe_invalid' }); }
    if (!parsed.nonce || !parsed.address || !parsed.expirationTime) return json(400, { ok: false, error: 'siwe_invalid' });
    if (parsed.expirationTime.getTime() <= now().getTime()) return json(401, { ok: false, error: 'siwe_expired' });
    if (parsed.chainId !== d.siwe.chainId) return json(401, { ok: false, error: 'siwe_wrong_chain' });
    const ok = await verifySiweMessage(d.siwe.client, {
      message: b.message, signature: b.signature as `0x${string}`, domain: d.siwe.domain, nonce: parsed.nonce, time: now(),
    }).catch(() => false);
    if (!ok) return json(401, { ok: false, error: 'siwe_bad_signature' });
    const signer = parsed.address.toLowerCase();
    const row = await d.db.query<{ wallet_address: string | null }>(
      'SELECT wallet_address FROM waitlist WHERE signup_token_hash=$1', [tokenHash]);
    if (row.rows.length === 0) return json(404, { ok: false, error: 'signup_not_found' });
    const existing = row.rows[0]!.wallet_address;
    if (existing && existing.toLowerCase() !== signer) return json(409, { ok: false, error: 'wallet_mismatch' });
    // Consume the nonce atomically: one use only, never after expiry.
    const used = await d.db.query(
      `UPDATE waitlist_nonces SET used_at=$2 WHERE nonce=$1 AND used_at IS NULL AND expires_at > $2 RETURNING nonce`,
      [parsed.nonce, now().toISOString()]);
    if (used.rows.length === 0) return json(401, { ok: false, error: 'siwe_nonce_invalid' });
    try {
      const r = await d.db.query(
        `UPDATE waitlist SET wallet_address=$2, verified=true, verified_via=COALESCE(verified_via,'siwe')
         WHERE signup_token_hash=$1 AND (wallet_address IS NULL OR lower(wallet_address)=$2) RETURNING id`,
        [tokenHash, signer]);
      if (r.rows.length === 0) return json(409, { ok: false, error: 'wallet_mismatch' });
    } catch (e) {
      if (/unique|duplicate/i.test((e as Error).message)) return json(409, { ok: false, error: 'wallet_already_used' });
      throw e;
    }
    return json(200, { ok: true, verified: true });
  }

  /** Signed link from campaign emails: marks the contact (and its duplicates) unsubscribed. */
  async function unsubscribe(q: URLSearchParams) {
    if (!d.unsubscribeSecret) return json(503, { ok: false, error: 'unsubscribe_disabled' });
    const id = verifyUnsubscribeToken(q.get('c') ?? '', q.get('s') ?? '', d.unsubscribeSecret);
    if (id == null) return json(400, { ok: false, error: 'unsubscribe_invalid' });
    const n = await doUnsubscribe(d.db, id, now());
    if (n === 0) return json(404, { ok: false, error: 'not_found' });
    return json(200, { ok: true, unsubscribed: true });
  }

  /** Structured log line for waitlist paths. Only the wallet address, never contact details. */
  function logWaitlist(path: string, req: ApiRequest, u: URL, r: ApiResponse) {
    let address: string | undefined = u.searchParams.get('address') ?? undefined;
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (!address && typeof b.message === 'string') {
      try { address = parseSiweMessage(b.message).address; } catch { /* unparsable */ }
    }
    if (!address && typeof b.wallet === 'string') address = b.wallet;
    const body = (r.body ?? {}) as { error?: string };
    console.log(JSON.stringify({
      evt: 'waitlist', path, status: r.status, error: body.error ?? null,
      address: address?.toLowerCase() ?? null, source: path === '/api/waitlist' ? u.searchParams.get('source') ?? null : undefined,
      hasSignature: path.endsWith('/verify') ? typeof b.signature === 'string' : undefined,
      at: now().toISOString(),
    }));
  }

  async function handle(req: ApiRequest): Promise<ApiResponse> {
    const r = await route(req);
    const u = new URL(req.url, 'http://x');
    const p = u.pathname.replace(/\/+$/, '');
    if (p.startsWith('/api/waitlist')) logWaitlist(p, req, u, r);
    return r;
  }

  async function route(req: ApiRequest): Promise<ApiResponse> {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname.replace(/\/+$/, '');
    const m = p.match(/^\/api\/vault\/(0x[0-9a-fA-F]{40})\/(balances|activity|approvals|limits|status)$/);
    try {
      if (req.method === 'GET' && m) {
        const v = m[1]!.toLowerCase();
        return m[2] === 'activity' ? await activity(v, u.searchParams) : await ({ balances, approvals, limits, status } as const)[m[2] as 'balances'](v);
      }
      if (req.method === 'GET' && p === '/api/agent') return await agent();
      if (req.method === 'GET' && p === '/api/quotes/stats') return await quoteStats(u.searchParams);
      if (req.method === 'GET' && p === '/api/waitlist/nonce') return await nonce(u.searchParams.get('address'));
      if (req.method === 'POST' && p === '/api/waitlist') return await waitlist(req.body, normaliseSource(u.searchParams.get('source')));
      if (req.method === 'GET' && p === '/api/waitlist/unsubscribe') return await unsubscribe(u.searchParams);
      if (req.method === 'POST' && p === '/api/waitlist/verify') return await verify(req.body);
      if (req.method === 'GET' && p === '/healthz') return json(200, { ok: true });
      return json(404, { error: 'not_found' });
    } catch (e) {
      console.error('api error:', (e as Error).message); // never log request bodies (PII)
      return json(500, { error: 'internal' });
    }
  }

  return { handle };
}

/** Plain node:http server around the handler, with CORS for the dashboard origin. */
export function serve(api: ReturnType<typeof createApi>, port: number, corsOrigin: string | string[]) {
  const origins = (Array.isArray(corsOrigin) ? corsOrigin : corsOrigin.split(','))
    .map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean);
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const reqOrigin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
    res.setHeader('Access-Control-Allow-Origin', origins.includes(reqOrigin) ? reqOrigin : origins[0] ?? '');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();
    let body: unknown;
    if (req.method === 'POST') {
      let raw = '';
      for await (const c of req) { raw += c; if (raw.length > 16_000) return void res.writeHead(413).end(); }
      try { body = JSON.parse(raw || 'null'); } catch { return void res.writeHead(400).end('{"error":"invalid_json"}'); }
    }
    const r = await api.handle({ method: req.method ?? 'GET', url: req.url ?? '/', body });
    res.writeHead(r.status, { 'content-type': 'application/json' }).end(JSON.stringify(r.body));
  });
  server.listen(port);
  return server;
}
