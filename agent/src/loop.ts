import { type Hex, type Log, decodeEventLog, formatUnits, parseUnits } from 'viem';
import {
  type Db, hasPendingApproval, insertActivity, insertApproval, insertRfqQuote, markExecuted, readyApproval,
  recentRejection, recordRun, REJECT_COOLDOWN_MS, REJECT_DRIFT_CHANGE_BPS, type RfqOutcome,
} from './db.js';
import type { FeedReading } from './feed.js';
import { decide, type StrategyDecision } from './strategy.js';
import { logQuote, valueNgn, type Decimals } from './pnl.js';
import type { RfqClient } from './rfq.js';
import type { RateSource } from './textile.js';
import { buildContractCall, type TaggedTx } from './txBuilder.js';
import { vaultAbi } from './vaultAbi.js';

const DAY = 86_400n;
/** Limits are always 1e18 = $1, whatever the token decimals. */
const USD_DEC = 18;

export const NO_OFFER = 'No offer from the exchange right now. Will try again next check.';
export const STALE_PRICE = 'Paused, waiting for a fresh naira price.';

export type OnchainLimits = {
  maxTradeUsd: bigint;
  maxDailyUsd: bigint;
  approvalThresholdUsd: bigint;
  maxSlippageBps: number;
  targetNgnBps: number;
};

export type VaultState = {
  ngnBalance: bigint;
  usdBalance: bigint;
  /** Read per token (6 on mainnet; mocks match). */
  ngnDecimals: number;
  usdDecimals: number;
  limits: OnchainLimits;
  dailySpentUsd: bigint;
  dayStart: bigint;
  paused: boolean;
};

export interface ChainPort {
  readState(): Promise<VaultState>;
  /** Sends via the tagged tx builder; resolves after the receipt. */
  send(tx: TaggedTx): Promise<{ hash: Hex; status: 'success' | 'reverted'; logs: Log[] }>;
  /** Chainlink NGN/USD reading (the vault's reference rate). */
  readFeed(): Promise<FeedReading>;
  /** Vault.minOutFloor: lowest minOut the vault will accept. */
  minOutFloor(tokenIn: `0x${string}`, tokenOut: `0x${string}`, amountIn: bigint): Promise<bigint>;
  /** Factory.isAllowedVenue(target, spender). */
  isAllowedVenue(target: `0x${string}`, spender: `0x${string}`): Promise<boolean>;
  /** Factory.venueLabelOf(target): the on-chain label used for `venue`. */
  venueLabel(target: `0x${string}`): Promise<string>;
}

export type LoopDeps = {
  vault: `0x${string}`;
  cngn: `0x${string}`;
  usdt: `0x${string}`;
  chainId: number;
  chain: ChainPort;
  /** Market ₦ per $1 for the strategy (the RFQ sets the real price). */
  rates: RateSource;
  rfq: RfqClient;
  db: Db;
  now?: () => Date;
  bandBps?: number;
  rejectCooldownMs?: number;
};

export type RunResult = { decision?: StrategyDecision; txHash?: Hex; skipped?: string; outcome?: RfqOutcome };

const toNum = (v: bigint, dec: number) => Number(formatUnits(v, dec));
const toUnits = (n: number, dec: number) => parseUnits(n.toFixed(Math.min(dec, 6)), dec);

/** One agent tick: read → (run approved | decide → RFQ swap | propose) → record. */
export async function runOnce(d: LoopDeps): Promise<RunResult> {
  const now = d.now?.() ?? new Date();
  try {
    const [s, rate, feed] = await Promise.all([
      d.chain.readState(), d.rates.getRateNgnPerUsd(), d.chain.readFeed().catch(() => undefined),
    ]);
    const dec: Decimals = { ngn: s.ngnDecimals, usd: s.usdDecimals };
    await logQuote(d.db, d.vault, s.ngnBalance, s.usdBalance, rate, now, dec);

    const skip = async (why: string, decision?: StrategyDecision): Promise<RunResult> => {
      await insertActivity(d.db, { vault: d.vault, kind: 'noop', reason: why, rate: String(rate), status: 'skipped' });
      await recordRun(d.db, d.vault, true);
      return { decision, skipped: why };
    };

    if (s.paused) return skip('Vault is paused by the owner, so no trade.');
    if (!feed || feed.stale) return skip(STALE_PRICE);

    // 1. An approved proposal inside its window runs first, with a fresh quote at approvedMinOut or better.
    const ready = await readyApproval(d.db, d.vault, now);
    if (ready) {
      const r = await rfqSwap(d, s, dec, rate, feed, now, {
        tokenIn: ready.tokenIn, tokenOut: ready.tokenOut, amountIn: BigInt(ready.amountIn),
        approvalId: BigInt(ready.onchainId), approvedMinOut: BigInt(ready.approvedMinOut), reason: ready.reason,
      });
      await recordRun(d.db, d.vault, r.outcome !== 'expired');
      return r;
    }

    const nowSec = BigInt(Math.floor(now.getTime() / 1000));
    const dailySpent = nowSec >= s.dayStart + DAY ? 0n : s.dailySpentUsd;
    const decision = decide({
      ngnBalance: toNum(s.ngnBalance, dec.ngn),
      usdBalance: toNum(s.usdBalance, dec.usd),
      rateNgnPerUsd: rate,
      dailySpentUsd: toNum(dailySpent, USD_DEC),
      bandBps: d.bandBps,
      limits: {
        maxTradeUsd: toNum(s.limits.maxTradeUsd, USD_DEC),
        maxDailyUsd: toNum(s.limits.maxDailyUsd, USD_DEC),
        approvalThresholdUsd: toNum(s.limits.approvalThresholdUsd, USD_DEC),
        maxSlippageBps: Math.floor(s.limits.maxSlippageBps / 2),
        targetNgnBps: s.limits.targetNgnBps,
      },
    });

    if (decision.action === 'none') return skip(decision.reason, decision);
    const [tokenIn, tokenOut] = decision.direction === 'ngnToUsd' ? [d.cngn, d.usdt] : [d.usdt, d.cngn];
    const [dIn, dOut] = decision.direction === 'ngnToUsd' ? [dec.ngn, dec.usd] : [dec.usd, dec.ngn];
    let amountIn = toUnits(decision.amountIn, dIn);
    const bal = decision.direction === 'ngnToUsd' ? s.ngnBalance : s.usdBalance;
    if (amountIn > bal) amountIn = bal;
    const ngnShareBps = shareBps(s.ngnBalance, s.usdBalance, rate, dec);

    if (decision.action === 'swap') {
      const r = await rfqSwap(d, s, dec, rate, feed, now, { tokenIn, tokenOut, amountIn, approvalId: 0n, reason: decision.reason });
      await recordRun(d.db, d.vault, r.outcome !== 'expired');
      return { ...r, decision };
    }

    // propose
    if (await hasPendingApproval(d.db, d.vault, now)) return skip('A proposal is already waiting for your approval.', decision);
    const rej = await recentRejection(d.db, d.vault, tokenIn, tokenOut, now, d.rejectCooldownMs ?? REJECT_COOLDOWN_MS);
    const driftMoved = rej?.ngnShareBps != null && Math.abs(ngnShareBps - rej.ngnShareBps) >= REJECT_DRIFT_CHANGE_BPS;
    if (rej && !driftMoved) return skip('You declined this trade recently, so the agent is waiting before asking again.', decision);

    // approvedMinOut: the strategy floor, never below what the vault's Chainlink floor allows.
    let minOut = toUnits(decision.minOut, dOut);
    const floor = await d.chain.minOutFloor(tokenIn, tokenOut, amountIn);
    if (minOut < floor) minOut = floor;
    const usdValue = toUnits(decision.usdValue, USD_DEC);

    const tx = buildContractCall({
      address: d.vault, abi: vaultAbi, functionName: 'proposeSwap', args: [tokenIn, tokenOut, amountIn, minOut],
    });
    const r = await d.chain.send(tx);
    const status = r.status === 'success' ? 'confirmed' : 'failed';
    await insertActivity(d.db, {
      vault: d.vault, kind: 'propose', tokenIn, tokenOut, amountIn: amountIn.toString(), minOut: minOut.toString(),
      usdValue: usdValue.toString(), rate: String(rate), reason: decision.reason, txHash: r.hash, status,
    });
    if (r.status === 'success') {
      for (const log of r.logs) {
        try {
          const ev = decodeEventLog({ abi: vaultAbi, data: log.data, topics: log.topics });
          if (ev.eventName === 'SwapProposed') {
            await insertApproval(d.db, {
              vault: d.vault, onchainId: ev.args.id.toString(), tokenIn, tokenOut, amountIn: amountIn.toString(),
              minOut: minOut.toString(), usdValue: usdValue.toString(), reason: decision.reason, txHash: r.hash,
              expiresAt: new Date(Number(ev.args.expiresAt) * 1000), ngnShareBps,
            });
          }
        } catch {
          /* not a vault event */
        }
      }
    }
    await recordRun(d.db, d.vault, status === 'confirmed', status === 'failed' ? 'tx reverted' : undefined);
    return { decision, txHash: r.hash };
  } catch (err) {
    await recordRun(d.db, d.vault, false, (err as Error).message.slice(0, 500)).catch(() => {});
    throw err;
  }
}

type SwapReq = {
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountIn: bigint;
  approvalId: bigint;
  approvedMinOut?: bigint;
  reason: string;
};

/** Request a quote (taker = vault), log it, check it, and send swapViaRfq if it's good. Every RFQ gets a row. */
async function rfqSwap(
  d: LoopDeps, s: VaultState, dec: Decimals, rate: number, feed: FeedReading, now: Date, q: SwapReq,
): Promise<RunResult> {
  const ngnToUsd = q.tokenIn.toLowerCase() === d.cngn.toLowerCase();
  const [dIn, dOut] = ngnToUsd ? [dec.ngn, dec.usd] : [dec.usd, dec.ngn];
  const side = ngnToUsd ? 'ngnToUsd' : 'usdToNgn';
  const sizeUsd = ngnToUsd ? toNum(q.amountIn, dIn) / rate : toNum(q.amountIn, dIn);
  const base = {
    vault: d.vault, venue: d.rfq.venue, side, tokenIn: q.tokenIn, tokenOut: q.tokenOut, sellAmount: q.amountIn.toString(),
    sizeUsd, feedRate: feed.rateNgnPerUsd, feedUpdatedAt: feed.updatedAt,
    approvalId: q.approvalId ? q.approvalId.toString() : undefined, requestedAt: now,
  } as const;
  const note = async (why: string, outcome: RfqOutcome): Promise<RunResult> => {
    await insertActivity(d.db, { vault: d.vault, kind: 'noop', reason: why, rate: String(rate), status: 'skipped' });
    return { skipped: why, outcome };
  };

  const quote = await d.rfq.request({
    chainId: d.chainId, sellToken: q.tokenIn, buyToken: q.tokenOut, sellAmount: q.amountIn, taker: d.vault,
  });
  if (!quote.quoted) {
    await insertRfqQuote(d.db, { ...base, quoted: false, outcome: 'no_quote', outcomeReason: quote.reason });
    return note(NO_OFFER, 'no_quote');
  }

  const inN = toNum(quote.takerPays, dIn);
  const outN = toNum(quote.buyAmount, dOut);
  const qRate = ngnToUsd ? (outN > 0 ? inN / outN : 0) : (inN > 0 ? outN / inN : 0);
  const quoted = {
    ...base, quoted: true, takerPays: quote.takerPays.toString(), buyAmount: quote.buyAmount.toString(),
    rate: qRate, expiresAt: quote.expiresAt,
  };
  const decline = async (outcome: RfqOutcome, why: string, activity: string) => {
    await insertRfqQuote(d.db, { ...quoted, outcome, outcomeReason: why });
    return note(activity, outcome);
  };

  if (quote.takerPays > q.amountIn) return decline('declined', 'taker_pays_above_amount', 'The exchange asked for more than planned, so no trade.');
  if (!(await d.chain.isAllowedVenue(quote.target, quote.spender))) {
    return decline('declined', 'venue_not_allowlisted', 'The exchange route is not on the allowlist, so no trade.');
  }
  const floor = await d.chain.minOutFloor(q.tokenIn, q.tokenOut, quote.takerPays);
  if (quote.buyAmount < floor) return decline('declined', 'below_feed_floor', 'The exchange price was too far below the naira reference rate, so no trade.');
  if (q.approvedMinOut !== undefined && quote.buyAmount < q.approvedMinOut) {
    return decline('price_moved', 'below_approved_min_out', "Price moved, didn't trade.");
  }
  if (quote.expiresAt.getTime() <= now.getTime()) return decline('expired', 'expired_before_send', 'The offer expired before it could be used.');

  // The agent signs this tx (tagged), the vault is the taker. Never a user-signed order for a third-party filler.
  const tx = buildContractCall({
    address: d.vault,
    abi: vaultAbi,
    functionName: 'swapViaRfq',
    args: [q.tokenIn, q.tokenOut, quote.takerPays, quote.buyAmount, quote.target, quote.spender, quote.data, q.approvalId],
  });
  const r = await d.chain.send(tx);
  if (r.status !== 'success') {
    await insertRfqQuote(d.db, { ...quoted, outcome: 'expired', outcomeReason: 'tx_reverted', txHash: r.hash });
    await insertActivity(d.db, {
      vault: d.vault, kind: 'swap', tokenIn: q.tokenIn, tokenOut: q.tokenOut, amountIn: quote.takerPays.toString(),
      minOut: quote.buyAmount.toString(), rate: String(qRate), reason: q.reason, txHash: r.hash, status: 'failed',
    });
    return { txHash: r.hash, outcome: 'expired' };
  }

  const ev = swappedEvent(r.logs, d.vault);
  const after = await d.chain.readState();
  let amountOut = ev?.amountOut;
  if (amountOut === undefined) {
    const delta = ngnToUsd ? after.usdBalance - s.usdBalance : after.ngnBalance - s.ngnBalance;
    amountOut = delta >= 0n ? delta : undefined;
  }
  // venue comes from the target the vault actually called, labelled by the factory. Never from the quote/agent.
  const venue = ev?.target ? await d.chain.venueLabel(ev.target).catch(() => '') : '';
  const usdValue = toUnits(ngnToUsd ? toNum(amountOut ?? quote.buyAmount, dOut) : inN, USD_DEC);
  await insertRfqQuote(d.db, { ...quoted, outcome: 'filled', txHash: r.hash, amountOut: amountOut?.toString() });
  await insertActivity(d.db, {
    vault: d.vault, kind: 'swap', tokenIn: q.tokenIn, tokenOut: q.tokenOut, amountIn: quote.takerPays.toString(),
    minOut: quote.buyAmount.toString(), amountOut: amountOut?.toString(), usdValue: usdValue.toString(),
    rate: String(qRate), reason: q.reason, txHash: r.hash, status: 'confirmed',
    venue: venue || null, venueTarget: ev?.target ?? null,
  });
  if (q.approvalId) await markExecuted(d.db, d.vault, q.approvalId.toString(), r.hash, now);

  // Per-swap P&L: value change across the swap at the same rate (fees + slippage).
  const fee = valueNgn(after.ngnBalance, after.usdBalance, rate, dec) - valueNgn(s.ngnBalance, s.usdBalance, rate, dec);
  const p = await logQuote(d.db, d.vault, after.ngnBalance, after.usdBalance, rate, now, dec);
  await d.db.query(
    `UPDATE activity SET fee_ngn=$1, pnl_ngn=$2 WHERE id=(SELECT max(id) FROM activity WHERE vault=$3 AND tx_hash=$4)`,
    [String(fee), String(p.pnlNgn), d.vault, r.hash]);
  return { txHash: r.hash, outcome: 'filled' };
}

/** The vault's own Swapped event in a receipt (ignores logs from other contracts). */
export function swappedEvent(logs: Log[], vault: string): { amountOut: bigint; target: `0x${string}` } | undefined {
  for (const log of logs) {
    if (log.address && log.address.toLowerCase() !== vault.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: vaultAbi, data: log.data, topics: log.topics });
      if (ev.eventName === 'Swapped') return { amountOut: ev.args.amountOut, target: ev.args.target };
    } catch {
      /* not a vault event */
    }
  }
  return undefined;
}

export const swappedAmountOut = (logs: Log[], vault: string) => swappedEvent(logs, vault)?.amountOut;

/** cNGN share of vault value in bps at `rate` (₦ per $1). */
export function shareBps(ngn: bigint, usd: bigint, rate: number, dec: Decimals = { ngn: 18, usd: 18 }): number {
  const n = toNum(ngn, dec.ngn);
  const total = n + toNum(usd, dec.usd) * rate;
  return total > 0 ? Math.round((n / total) * 10_000) : 0;
}
