/**
 * NairaGuard rebalancing strategy (design.md §2). Pure: no I/O, no clock, no randomness.
 *
 * Amounts are human units (₦ for cNGN, $ for USD₮); the tx layer converts to token units.
 */

export type Limits = {
  maxTradeUsd: number;
  maxDailyUsd: number;
  approvalThresholdUsd: number;
  maxSlippageBps: number;
  targetNgnBps: number;
};

export type StrategyInput = {
  /** cNGN held, in ₦. */
  ngnBalance: number;
  /** USD₮ held, in $. */
  usdBalance: number;
  /** Quoted ₦ per $1. */
  rateNgnPerUsd: number;
  limits: Limits;
  /** USD already spent today against maxDailyUsd. */
  dailySpentUsd: number;
  /** Rebalance only when drift exceeds this (bps of portfolio). Default 500 = 5%. */
  bandBps?: number;
  /** Skip trades smaller than this many $. Default 1. */
  minTradeUsd?: number;
};

export type Direction = 'ngnToUsd' | 'usdToNgn';

export type StrategyDecision =
  | { action: 'none'; ngnShareBps: number; reason: string }
  | {
      action: 'swap' | 'propose';
      direction: Direction;
      /** Input amount: ₦ when ngnToUsd, $ when usdToNgn. */
      amountIn: number;
      /** Expected output at the quoted rate. */
      expectedOut: number;
      /** Minimum acceptable output after maxSlippageBps. */
      minOut: number;
      usdValue: number;
      ngnShareBps: number;
      reason: string;
    };

export const DEFAULT_BAND_BPS = 500;
const BPS = 10_000;

export function formatNgn(n: number): string {
  return `₦${Math.round(n).toLocaleString('en-NG')}`;
}

export function formatUsd(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(bps: number): string {
  return `${Math.round(bps / 100)}%`;
}

export function decide(input: StrategyInput): StrategyDecision {
  const { ngnBalance, usdBalance, rateNgnPerUsd: rate, limits, dailySpentUsd } = input;
  const band = input.bandBps ?? DEFAULT_BAND_BPS;
  const minTrade = input.minTradeUsd ?? 1;

  if (!(rate > 0)) throw new Error('rateNgnPerUsd must be > 0');

  const ngnInUsd = ngnBalance / rate;
  const totalUsd = ngnInUsd + usdBalance;
  if (totalUsd <= 0) {
    return { action: 'none', ngnShareBps: 0, reason: 'Vault is empty, so there is nothing to rebalance.' };
  }

  const ngnShareBps = Math.round((ngnInUsd / totalUsd) * BPS);
  const target = limits.targetNgnBps;
  const drift = ngnShareBps - target;
  const head = `Naira share is ${pct(ngnShareBps)}, target ${pct(target)}.`;

  if (Math.abs(drift) <= band) {
    return {
      action: 'none',
      ngnShareBps,
      reason: `${head} That's within the ${pct(band)} band, so no trade.`,
    };
  }

  const idealUsd = (Math.abs(drift) / BPS) * totalUsd;
  const dailyLeft = Math.max(0, limits.maxDailyUsd - dailySpentUsd);
  const usdValue = Math.min(idealUsd, limits.maxTradeUsd, dailyLeft);

  if (usdValue < minTrade) {
    return {
      action: 'none',
      ngnShareBps,
      reason: `${head} The daily limit of ${formatUsd(limits.maxDailyUsd)} is used up, so no trade until tomorrow.`,
    };
  }

  const direction: Direction = drift > 0 ? 'ngnToUsd' : 'usdToNgn';
  const amountIn = direction === 'ngnToUsd' ? usdValue * rate : usdValue;
  const expectedOut = direction === 'ngnToUsd' ? usdValue : usdValue * rate;
  const minOut = (expectedOut * (BPS - limits.maxSlippageBps)) / BPS;
  const action = usdValue >= limits.approvalThresholdUsd ? 'propose' : 'swap';

  const ngnAmt = formatNgn(direction === 'ngnToUsd' ? amountIn : expectedOut);
  const usdAmt = formatUsd(usdValue);
  const rateTxt = `${formatNgn(rate)}/$`;
  const move =
    direction === 'ngnToUsd'
      ? `${ngnAmt} (${usdAmt}) to USD₮ at ${rateTxt}`
      : `${usdAmt} (${ngnAmt}) to cNGN at ${rateTxt}`;
  const capped = usdValue < idealUsd ? ' Capped by your limits.' : '';
  const reason =
    action === 'swap'
      ? `${head} Moved ${move}.${capped}`
      : `${head} Wants to move ${move}. This is over your approval limit, so it needs your OK.${capped}`;

  return { action, direction, amountIn, expectedOut, minOut, usdValue, ngnShareBps, reason };
}
