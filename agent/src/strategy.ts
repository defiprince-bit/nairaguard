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

/** Stable reason for a no-trade decision (used to dedupe "checked" activity rows). */
export type NoTradeCode = 'empty' | 'in_band' | 'below_min' | 'daily_limit' | 'trade_limit';

export type Direction = 'ngnToUsd' | 'usdToNgn';

export type StrategyDecision =
  | { action: 'none'; ngnShareBps: number; reason: string; code: NoTradeCode }
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
    return { action: 'none', ngnShareBps: 0, code: 'empty', reason: 'Vault is empty, so there is nothing to rebalance.' };
  }

  const ngnShareBps = Math.round((ngnInUsd / totalUsd) * BPS);
  const target = limits.targetNgnBps;
  const drift = ngnShareBps - target;
  const head = `Naira share is ${pct(ngnShareBps)}, target ${pct(target)}.`;

  if (Math.abs(drift) <= band) {
    return {
      action: 'none',
      ngnShareBps,
      code: 'in_band',
      reason: `${head} At your target — the agent will trade when the naira moves or a better rate appears.`,
    };
  }

  const idealUsd = (Math.abs(drift) / BPS) * totalUsd;
  const dailyLeft = Math.max(0, limits.maxDailyUsd - dailySpentUsd);
  const usdValue = Math.min(idealUsd, limits.maxTradeUsd, dailyLeft);

  if (usdValue < minTrade) {
    // Say why honestly: the move itself is tiny, or the daily / per-trade limit is what's capping it.
    if (idealUsd < minTrade) {
      return {
        action: 'none', ngnShareBps, code: 'below_min',
        reason: `${head} Rebalancing would move only ${formatUsd(idealUsd)}, under the ${formatUsd(minTrade)} minimum trade, so no trade.`,
      };
    }
    if (dailyLeft < minTrade) {
      return {
        action: 'none', ngnShareBps, code: 'daily_limit',
        reason: `${head} The daily limit of ${formatUsd(limits.maxDailyUsd)} is used up, so no trade until tomorrow.`,
      };
    }
    return {
      action: 'none', ngnShareBps, code: 'trade_limit',
      reason: `${head} Your per-trade limit of ${formatUsd(limits.maxTradeUsd)} is under the ${formatUsd(minTrade)} minimum trade, so no trade.`,
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

/* ---------------- Spread mode (Textile FX): trade when a live quote beats the reference feed. ---------------- */

export type SpreadConfig = {
  enabled: boolean;
  /** Quote must beat the feed by at least this many bps. */
  minEdgeBps: number;
  /** Slice size: bps of the vault's balance on the selling side. */
  sliceBps: number;
  /** Smallest slice in $ (covers Textile's minimum size). */
  minTradeUsd: number;
};

export const SPREAD_DEFAULTS: SpreadConfig = { enabled: false, minEdgeBps: 50, sliceBps: 2500, minTradeUsd: 1.1 };

/** Read spread settings from env. Off unless SPREAD_MODE_ENABLED=true. */
export function spreadConfigFromEnv(env: Record<string, string | undefined> = process.env): SpreadConfig {
  const num = (v: string | undefined, d: number) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    enabled: (env.SPREAD_MODE_ENABLED ?? '').toLowerCase() === 'true',
    minEdgeBps: num(env.SPREAD_MIN_BPS, SPREAD_DEFAULTS.minEdgeBps),
    sliceBps: Math.min(BPS, Math.max(0, num(env.SPREAD_SLICE_BPS, SPREAD_DEFAULTS.sliceBps))),
    minTradeUsd: Math.max(1, num(env.SPREAD_MIN_TRADE_USD, SPREAD_DEFAULTS.minTradeUsd)),
  };
}

/**
 * How much better than the feed a quote is, in bps (positive = better for the vault).
 * Rates are ₦ per $1. Selling cNGN: fewer ₦ per $ is better. Buying cNGN: more ₦ per $ is better.
 */
export function spreadEdgeBps(direction: Direction, quoteRate: number, feedRate: number): number {
  if (!(quoteRate > 0) || !(feedRate > 0)) return -Infinity;
  const edge = direction === 'ngnToUsd' ? (feedRate - quoteRate) / feedRate : (quoteRate - feedRate) / feedRate;
  return Math.round(edge * BPS);
}

export type SpreadPlan = { direction: Direction; amountIn: number; usdValue: number; reason: string };

/**
 * Candidate spread trades, best first. Sell a slice of cNGN; buy cNGN back only while the naira share is
 * under target (never past it). Sized under maxTradeUsd, the daily room and the approval threshold
 * (spread trades never need a proposal), and skipped below minTradeUsd. The quote check happens in the loop.
 */
export function planSpread(input: StrategyInput & { cfg: SpreadConfig }): SpreadPlan[] {
  const { ngnBalance, usdBalance, rateNgnPerUsd: rate, limits, dailySpentUsd, cfg } = input;
  if (!cfg.enabled || !(rate > 0)) return [];
  const dailyLeft = Math.max(0, limits.maxDailyUsd - dailySpentUsd);
  // Strictly under the approval threshold so the trade is a direct swap (a tiny margin for rounding).
  const approvalCap = limits.approvalThresholdUsd > 0 ? limits.approvalThresholdUsd * 0.999 : Infinity;
  const cap = (usd: number) => Math.min(usd, limits.maxTradeUsd, dailyLeft, approvalCap);
  const out: SpreadPlan[] = [];
  const totalUsd = ngnBalance / rate + usdBalance;
  if (totalUsd <= 0) return out;

  const sellUsd = cap(((ngnBalance / rate) * cfg.sliceBps) / BPS);
  if (sellUsd >= cfg.minTradeUsd) {
    out.push({
      direction: 'ngnToUsd', amountIn: sellUsd * rate, usdValue: sellUsd,
      reason: `Better rate: sold ${formatNgn(sellUsd * rate)} (${formatUsd(sellUsd)}) to USD₮ because the exchange beat the reference rate.`,
    });
  }
  const shareBps = ((ngnBalance / rate) / totalUsd) * BPS;
  const gapUsd = ((limits.targetNgnBps - shareBps) / BPS) * totalUsd;
  if (gapUsd > 0) {
    const buyUsd = cap(Math.min(gapUsd, (usdBalance * cfg.sliceBps) / BPS));
    if (buyUsd >= cfg.minTradeUsd) {
      out.push({
        direction: 'usdToNgn', amountIn: buyUsd, usdValue: buyUsd,
        reason: `Better rate: bought back ${formatNgn(buyUsd * rate)} with ${formatUsd(buyUsd)} toward your target because the exchange beat the reference rate.`,
      });
    }
  }
  return out;
}
