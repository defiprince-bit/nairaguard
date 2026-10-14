import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Minimal query interface satisfied by both `pg` Pool and PGlite. */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec?(sql: string): Promise<unknown>;
}

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function migrate(db: Db, dir = MIGRATIONS_DIR): Promise<string[]> {
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = readFileSync(join(dir, f), 'utf8');
    if (db.exec) await db.exec(sql);
    else await db.query(sql);
  }
  return files;
}

/** Connect: DATABASE_URL → pg; otherwise an embedded PGlite (dev/test only). */
export async function connect(databaseUrl = process.env.DATABASE_URL): Promise<Db> {
  if (databaseUrl) {
    const { default: pg } = await import('pg');
    return new pg.Pool({ connectionString: databaseUrl }) as unknown as Db;
  }
  const { PGlite } = await import('@electric-sql/pglite');
  return new PGlite(process.env.PGLITE_DIR) as unknown as Db;
}

export type ActivityRow = {
  vault: string;
  kind: 'swap' | 'propose' | 'noop';
  tokenIn?: string;
  tokenOut?: string;
  amountIn?: string;
  minOut?: string;
  /** Actual tokenOut received (swap only). */
  amountOut?: string;
  usdValue?: string;
  rate?: string;
  reason: string;
  txHash?: string;
  status: 'pending' | 'confirmed' | 'failed' | 'skipped';
  /** Pair label from the factory for the target in the vault's Swapped event. */
  venue?: string | null;
  venueTarget?: string | null;
};

export async function insertActivity(db: Db, a: ActivityRow): Promise<void> {
  await db.query(
    `INSERT INTO activity (vault, kind, token_in, token_out, amount_in, min_out, usd_value, rate, reason, tx_hash, status, amount_out, venue, venue_target)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [a.vault, a.kind, a.tokenIn ?? null, a.tokenOut ?? null, a.amountIn ?? null, a.minOut ?? null,
     a.usdValue ?? null, a.rate ?? null, a.reason, a.txHash ?? null, a.status, a.amountOut ?? null,
     a.venue ?? null, a.venueTarget?.toLowerCase() ?? null],
  );
}

export async function insertApproval(
  db: Db,
  a: {
    vault: string; onchainId: string; tokenIn: string; tokenOut: string; amountIn: string;
    minOut: string; usdValue: string; reason: string; txHash: string; expiresAt: Date; ngnShareBps?: number;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO approvals (vault, onchain_id, token_in, token_out, amount_in, min_out, usd_value, reason, tx_hash, expires_at, ngn_share_bps)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (vault, onchain_id) DO NOTHING`,
    [a.vault, a.onchainId, a.tokenIn, a.tokenOut, a.amountIn, a.minOut, a.usdValue, a.reason, a.txHash,
     a.expiresAt.toISOString(), a.ngnShareBps ?? null],
  );
}

export async function hasPendingApproval(db: Db, vault: string, now: Date): Promise<boolean> {
  const r = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM approvals WHERE vault=$1 AND status='pending' AND expires_at > $2`,
    [vault, now.toISOString()],
  );
  return (r.rows[0]?.n ?? 0) > 0;
}

export async function recordRun(db: Db, vault: string, ok: boolean, error?: string): Promise<void> {
  await db.query(`INSERT INTO agent_runs (vault, ok, error) VALUES ($1,$2,$3)`, [vault, ok, error ?? null]);
}

/** Default wait before re-proposing a trade the owner rejected. */
export const REJECT_COOLDOWN_MS = 6 * 60 * 60_000;
/** Drift change (cNGN share, bps) that counts as "meaningfully changed" and lifts the cooldown early. */
export const REJECT_DRIFT_CHANGE_BPS = 500;

/** Most recent rejection of the same pair + direction within the cooldown window, if any. */
export async function recentRejection(
  db: Db, vault: string, tokenIn: string, tokenOut: string, now: Date, cooldownMs = REJECT_COOLDOWN_MS,
): Promise<{ ngnShareBps: number | null; rejectedAt: Date } | undefined> {
  const r = await db.query<{ ngn_share_bps: number | null; rejected_at: string | Date }>(
    `SELECT ngn_share_bps, rejected_at FROM approvals
     WHERE lower(vault)=lower($1) AND lower(token_in)=lower($2) AND lower(token_out)=lower($3)
       AND status='rejected' AND rejected_at > $4
     ORDER BY rejected_at DESC LIMIT 1`,
    [vault, tokenIn, tokenOut, new Date(now.getTime() - cooldownMs).toISOString()]);
  const x = r.rows[0];
  return x && { ngnShareBps: x.ngn_share_bps, rejectedAt: new Date(x.rejected_at) };
}

/** Apply an on-chain SwapRejected: approval → rejected (final), its propose activity row → rejected. */
export async function markRejected(db: Db, vault: string, onchainId: string, txHash: string | null, at: Date): Promise<boolean> {
  const r = await db.query<{ tx_hash: string | null }>(
    `UPDATE approvals SET status='rejected', rejected_at=$3, reject_tx=$4
     WHERE lower(vault)=lower($1) AND onchain_id=$2 AND status <> 'rejected' RETURNING tx_hash`,
    [vault, onchainId, at.toISOString(), txHash]);
  if (!r.rows.length) return false;
  if (r.rows[0]!.tx_hash) {
    await db.query(`UPDATE activity SET status='rejected' WHERE lower(vault)=lower($1) AND kind='propose' AND tx_hash=$2`,
      [vault, r.rows[0]!.tx_hash]);
  }
  return true;
}

export type RfqOutcome = 'filled' | 'expired' | 'declined' | 'no_quote' | 'price_moved';

export type RfqQuoteRow = {
  vault: string; venue: string; side: 'ngnToUsd' | 'usdToNgn'; tokenIn: string; tokenOut: string; sellAmount: string;
  sizeUsd?: number; quoted: boolean; takerPays?: string; buyAmount?: string; rate?: number;
  feedRate?: number | null; feedUpdatedAt?: Date; expiresAt?: Date; approvalId?: string;
  outcome: RfqOutcome; outcomeReason?: string; txHash?: string; amountOut?: string; requestedAt: Date;
};

/** One row per RFQ, whatever happened (design.md §8). */
export async function insertRfqQuote(db: Db, q: RfqQuoteRow): Promise<void> {
  await db.query(
    `INSERT INTO textile_quotes (vault, venue, side, token_in, token_out, sell_amount, size_usd, quoted, taker_pays, buy_amount,
       rate_ngn_per_usd, feed_rate_ngn_per_usd, feed_updated_at, expires_at, approval_id, outcome, outcome_reason, tx_hash,
       amount_out, requested_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [q.vault.toLowerCase(), q.venue, q.side, q.tokenIn, q.tokenOut, q.sellAmount, q.sizeUsd ?? null, q.quoted,
     q.takerPays ?? null, q.buyAmount ?? null, q.rate ?? null, q.feedRate ?? null, q.feedUpdatedAt?.toISOString() ?? null,
     q.expiresAt?.toISOString() ?? null, q.approvalId ?? null, q.outcome, q.outcomeReason ?? null, q.txHash ?? null,
     q.amountOut ?? null, q.requestedAt.toISOString()]);
}

/** On-chain SwapApproved: approval → approved, with its execution window. */
export async function markApproved(db: Db, vault: string, onchainId: string, windowExpiresAt: Date, at: Date): Promise<boolean> {
  const r = await db.query(
    `UPDATE approvals SET status='approved', approved_at=$3, window_expires_at=$4
     WHERE lower(vault)=lower($1) AND onchain_id=$2 AND status='pending' RETURNING onchain_id`,
    [vault, onchainId, at.toISOString(), windowExpiresAt.toISOString()]);
  return r.rows.length > 0;
}

export async function markExecuted(db: Db, vault: string, onchainId: string, txHash: string, at: Date): Promise<void> {
  await db.query(
    `UPDATE approvals SET status='executed', executed_tx=$3, executed_at=$4
     WHERE lower(vault)=lower($1) AND onchain_id=$2 AND status='approved'`,
    [vault, onchainId, txHash, at.toISOString()]);
}

/** Oldest approved proposal whose window is still open. */
export async function readyApproval(db: Db, vault: string, now: Date) {
  const r = await db.query<{ onchain_id: string; token_in: `0x${string}`; token_out: `0x${string}`; amount_in: string; min_out: string; reason: string }>(
    `SELECT onchain_id, token_in, token_out, amount_in, min_out, reason FROM approvals
     WHERE lower(vault)=lower($1) AND status='approved' AND window_expires_at > $2
     ORDER BY approved_at ASC LIMIT 1`,
    [vault, now.toISOString()]);
  const x = r.rows[0];
  return x && {
    onchainId: x.onchain_id, tokenIn: x.token_in, tokenOut: x.token_out, amountIn: x.amount_in,
    approvedMinOut: x.min_out, reason: x.reason,
  };
}
