import { type Hex, type Log, decodeEventLog, formatUnits, parseUnits } from 'viem';
import { type Db, hasPendingApproval, insertActivity, insertApproval, recordRun } from './db.js';
import { decide, type StrategyDecision } from './strategy.js';
import { logQuote, valueNgn } from './pnl.js';
import type { RateSource } from './textile.js';
import { buildContractCall, type TaggedTx } from './txBuilder.js';
import { vaultAbi } from './vaultAbi.js';

const DECIMALS = 18;
const DAY = 86_400n;

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
  limits: OnchainLimits;
  dailySpentUsd: bigint;
  dayStart: bigint;
  paused: boolean;
};

export interface ChainPort {
  readState(): Promise<VaultState>;
  /** Sends via the tagged tx builder; resolves after the receipt. */
  send(tx: TaggedTx): Promise<{ hash: Hex; status: 'success' | 'reverted'; logs: Log[] }>;
}

export type LoopDeps = {
  vault: `0x${string}`;
  cngn: `0x${string}`;
  usdt: `0x${string}`;
  chain: ChainPort;
  rates: RateSource;
  db: Db;
  now?: () => Date;
  bandBps?: number;
};

export type RunResult = { decision: StrategyDecision; txHash?: Hex; skipped?: string };

const toNum = (v: bigint) => Number(formatUnits(v, DECIMALS));
const toUnits = (n: number) => parseUnits(n.toFixed(6), DECIMALS);

/** One agent tick: read → decide → (swap | propose) → record. */
export async function runOnce(d: LoopDeps): Promise<RunResult> {
  const now = d.now?.() ?? new Date();
  try {
    const [s, rate] = await Promise.all([d.chain.readState(), d.rates.getRateNgnPerUsd()]);
    await logQuote(d.db, d.vault, s.ngnBalance, s.usdBalance, rate, now);
    const nowSec = BigInt(Math.floor(now.getTime() / 1000));
    const dailySpent = nowSec >= s.dayStart + DAY ? 0n : s.dailySpentUsd;

    const decision = decide({
      ngnBalance: toNum(s.ngnBalance),
      usdBalance: toNum(s.usdBalance),
      rateNgnPerUsd: rate,
      dailySpentUsd: toNum(dailySpent),
      bandBps: d.bandBps,
      limits: {
        maxTradeUsd: toNum(s.limits.maxTradeUsd),
        maxDailyUsd: toNum(s.limits.maxDailyUsd),
        approvalThresholdUsd: toNum(s.limits.approvalThresholdUsd),
        // Use half the on-chain tolerance so rounding never trips the vault's own check.
        maxSlippageBps: Math.floor(s.limits.maxSlippageBps / 2),
        targetNgnBps: s.limits.targetNgnBps,
      },
    });

    const skip = async (why: string): Promise<RunResult> => {
      await insertActivity(d.db, { vault: d.vault, kind: 'noop', reason: why, rate: String(rate), status: 'skipped' });
      await recordRun(d.db, d.vault, true);
      return { decision, skipped: why };
    };

    if (decision.action === 'none') return skip(decision.reason);
    if (s.paused) return skip('Vault is paused by the owner, so no trade.');
    if (decision.action === 'propose' && (await hasPendingApproval(d.db, d.vault, now))) {
      return skip('A proposal is already waiting for your approval.');
    }

    let usdValue = toUnits(decision.usdValue);
    // Never request more than the on-chain caps (float rounding guard).
    if (usdValue > s.limits.maxTradeUsd) usdValue = s.limits.maxTradeUsd;
    const [tokenIn, tokenOut] = decision.direction === 'ngnToUsd' ? [d.cngn, d.usdt] : [d.usdt, d.cngn];
    let amountIn = toUnits(decision.amountIn);
    const bal = decision.direction === 'ngnToUsd' ? s.ngnBalance : s.usdBalance;
    if (amountIn > bal) amountIn = bal;
    const minOut = toUnits(decision.minOut);

    const tx = buildContractCall({
      address: d.vault,
      abi: vaultAbi,
      functionName: decision.action === 'swap' ? 'swap' : 'proposeSwap',
      args: [tokenIn, tokenOut, amountIn, minOut, usdValue],
    });

    const r = await d.chain.send(tx);
    const status = r.status === 'success' ? 'confirmed' : 'failed';

    // Actual amount out: the vault's Swapped event, else the tokenOut balance delta. Never minOut.
    let after: VaultState | undefined;
    let amountOut: bigint | undefined;
    if (decision.action === 'swap' && status === 'confirmed') {
      amountOut = swappedAmountOut(r.logs, d.vault);
      after = await d.chain.readState();
      if (amountOut === undefined) {
        amountOut = decision.direction === 'ngnToUsd' ? after.usdBalance - s.usdBalance : after.ngnBalance - s.ngnBalance;
        if (amountOut < 0n) amountOut = undefined;
      }
    }
    await insertActivity(d.db, {
      vault: d.vault,
      kind: decision.action,
      tokenIn,
      tokenOut,
      amountIn: amountIn.toString(),
      minOut: minOut.toString(),
      amountOut: amountOut?.toString(),
      usdValue: usdValue.toString(),
      rate: String(rate),
      reason: decision.reason,
      txHash: r.hash,
      status,
    });

    if (after) {
      // Per-swap P&L: value change across the swap at the same rate (fees + slippage).
      const fee = valueNgn(after.ngnBalance, after.usdBalance, rate) - valueNgn(s.ngnBalance, s.usdBalance, rate);
      const p = await logQuote(d.db, d.vault, after.ngnBalance, after.usdBalance, rate, now);
      await d.db.query(
        `UPDATE activity SET fee_ngn=$1, pnl_ngn=$2 WHERE id=(SELECT max(id) FROM activity WHERE vault=$3 AND tx_hash=$4)`,
        [String(fee), String(p.pnlNgn), d.vault, r.hash]);
    }

    if (decision.action === 'propose' && r.status === 'success') {
      for (const log of r.logs) {
        try {
          const ev = decodeEventLog({ abi: vaultAbi, data: log.data, topics: log.topics });
          if (ev.eventName === 'SwapProposed') {
            await insertApproval(d.db, {
              vault: d.vault,
              onchainId: ev.args.id.toString(),
              tokenIn,
              tokenOut,
              amountIn: amountIn.toString(),
              minOut: minOut.toString(),
              usdValue: usdValue.toString(),
              reason: decision.reason,
              txHash: r.hash,
              expiresAt: new Date(Number(ev.args.expiresAt) * 1000),
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

/** amountOut from the vault's own Swapped event in a receipt (ignores logs from other contracts). */
export function swappedAmountOut(logs: Log[], vault: string): bigint | undefined {
  for (const log of logs) {
    if (log.address && log.address.toLowerCase() !== vault.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: vaultAbi, data: log.data, topics: log.topics });
      if (ev.eventName === 'Swapped') return ev.args.amountOut;
    } catch {
      /* not a vault event */
    }
  }
  return undefined;
}
