import { formatUnits } from 'viem';
import type { Db } from './db.js';
import { AGENT_CHAIN_ID, STATS_DEFAULT_CHAIN_ID } from './config.js';

export type Decimals = { ngn: number; usd: number };
const D18: Decimals = { ngn: 18, usd: 18 };
const n = (v: bigint | string, dec: number) => Number(formatUnits(BigInt(v), dec));

/** Vault value in ₦ at `rate` (₦ per $1). */
export const valueNgn = (ngn: bigint | string, usd: bigint | string, rate: number, dec: Decimals = D18) =>
  n(ngn, dec.ngn) + n(usd, dec.usd) * rate;

export type Baseline = { ngnStart: string; usdStart: string; rateStart: string; fundedAt: Date };

/**
 * P&L = vault value now (₦) − starting balances valued at today's rate (no trading).
 * Uses real balances, so swap fees and slippage are already netted out.
 */
export function computePnl(b: Baseline, ngn: bigint | string, usd: bigint | string, rate: number, dec: Decimals = D18) {
  const value = valueNgn(ngn, usd, rate, dec);
  const hold = valueNgn(b.ngnStart, b.usdStart, rate, dec);
  const pnlNgn = value - hold;
  return { valueNgn: value, holdValueNgn: hold, pnlNgn, pnlUsd: pnlNgn / rate };
}

export async function getBaseline(db: Db, vault: string, chainId = STATS_DEFAULT_CHAIN_ID): Promise<Baseline | undefined> {
  const r = await db.query<{ ngn_start: string; usd_start: string; rate_start: string; funded_at: string | Date }>(
    'SELECT * FROM vault_baseline WHERE vault=$1 AND chain_id=$2', [vault.toLowerCase(), chainId]);
  const x = r.rows[0];
  return x && { ngnStart: x.ngn_start, usdStart: x.usd_start, rateStart: x.rate_start, fundedAt: new Date(x.funded_at) };
}

/** Records the baseline the first time the vault is seen funded, then logs this quote with its P&L. */
export async function logQuote(db: Db, vault: string, ngn: bigint, usd: bigint, rate: number, now: Date, dec: Decimals = D18, chainId = AGENT_CHAIN_ID) {
  const v = vault.toLowerCase();
  if (ngn > 0n || usd > 0n) {
    await db.query(
      `INSERT INTO vault_baseline (vault, ngn_start, usd_start, rate_start, funded_at, chain_id) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (vault) DO NOTHING`, [v, ngn.toString(), usd.toString(), String(rate), now.toISOString(), chainId]);
  }
  const b = await getBaseline(db, v, chainId);
  const p = b ? computePnl(b, ngn, usd, rate, dec) : { valueNgn: valueNgn(ngn, usd, rate, dec), holdValueNgn: 0, pnlNgn: 0 };
  await db.query(
    `INSERT INTO quotes (vault, rate, ngn_balance, usd_balance, value_ngn, hold_value_ngn, pnl_ngn, created_at, chain_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [v, String(rate), ngn.toString(), usd.toString(), String(p.valueNgn), String(p.holdValueNgn), String(p.pnlNgn), now.toISOString(), chainId]);
  return p;
}
