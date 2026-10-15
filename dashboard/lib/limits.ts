import { encodeFunctionData, formatUnits, parseAbi, parseUnits, type Hex } from 'viem';
import { sendTagged } from './sendTagged';
import { getProvider } from './wallet';
import { PRESETS, type Limits, type PresetId, tag, waitForReceipt } from './vault';
import type { ApiLimits } from './overviewView';

/**
 * USD limits are stored on-chain in 1e18 units: Vault.sol `_usdValue` is "USD value in 1e18 units
 * (same unit as `limits`)", and PRESETS / the agent API / usd18() all use 18 decimals.
 */
export const USD_DECIMALS = 18;

/** From contracts/src/Vault.sol: `function setLimits(Limits calldata newLimits) external onlyOwner`. */
export const vaultLimitsAbi = parseAbi([
  'function setLimits((uint256 maxTradeUsd, uint256 maxDailyUsd, uint256 approvalThresholdUsd, uint16 maxSlippageBps, uint16 targetNgnBps) newLimits)',
]);

export type LimitsForm = { maxTrade: string; maxDaily: string; askAbove: string; slippageBps: number; targetPct: number };
export type LimitErrors = Partial<Record<'maxTrade' | 'maxDaily' | 'askAbove', string>>;

/** "20" / "20.5" → on-chain USD units. Null when not a plain non-negative number. */
export function usdToUnits(v: string): bigint | null {
  const t = v.trim().replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const [w, d = ''] = t.split('.');
  if (d.length > USD_DECIMALS) return null;
  return parseUnits(`${w}${d ? '.' + d : ''}`, USD_DECIMALS);
}

export function unitsToUsd(v: string | bigint): string {
  const s = formatUnits(BigInt(v), USD_DECIMALS);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

/** 0–100 % → basis points (50 → 5000). Snaps to the slider's 5 % steps' integer bps. */
export function pctToBps(pct: number): number {
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new Error('target must be 0–100%');
  return Math.round(pct * 100);
}

export const bpsToPct = (bps: number) => bps / 100;

export function formFromApi(l: ApiLimits): LimitsForm {
  return {
    maxTrade: unitsToUsd(l.maxTradeUsd), maxDaily: unitsToUsd(l.maxDailyUsd), askAbove: unitsToUsd(l.approvalThresholdUsd),
    slippageBps: l.maxSlippageBps, targetPct: bpsToPct(l.targetNgnBps),
  };
}

export function formFromPreset(id: PresetId, targetPct: number): LimitsForm {
  const p = PRESETS[id].limits;
  return {
    maxTrade: unitsToUsd(p.maxTradeUsd), maxDaily: unitsToUsd(p.maxDailyUsd), askAbove: unitsToUsd(p.approvalThresholdUsd),
    slippageBps: p.maxSlippageBps, targetPct,
  };
}

/** Which preset the four limit values match (target is separate), else 'custom'. */
export function matchPreset(f: LimitsForm): PresetId | 'custom' {
  const t = usdToUnits(f.maxTrade), d = usdToUnits(f.maxDaily), a = usdToUnits(f.askAbove);
  for (const id of Object.keys(PRESETS) as PresetId[]) {
    const p = PRESETS[id].limits;
    if (t === p.maxTradeUsd && d === p.maxDailyUsd && a === p.approvalThresholdUsd && f.slippageBps === p.maxSlippageBps) return id;
  }
  return 'custom';
}

/** Plain-English inline errors. Empty object = valid. */
export function validateLimits(f: LimitsForm): LimitErrors {
  const e: LimitErrors = {};
  const t = usdToUnits(f.maxTrade), d = usdToUnits(f.maxDaily), a = usdToUnits(f.askAbove);
  if (t === null) e.maxTrade = 'Enter an amount in dollars, like 50.';
  else if (t <= 0n) e.maxTrade = 'Max per trade must be more than $0.';
  if (d === null) e.maxDaily = 'Enter an amount in dollars, like 150.';
  else if (d <= 0n) e.maxDaily = 'Daily max must be more than $0.';
  if (a === null) e.askAbove = 'Enter an amount in dollars, like 25.';
  else if (a <= 0n) e.askAbove = '"Ask me above" must be more than $0.';
  if (t !== null && d !== null && t > 0n && d > 0n && t > d) e.maxTrade = 'Max per trade can’t be more than your daily max.';
  if (a !== null && t !== null && a > 0n && t > 0n && a > t) e.askAbove = '"Ask me above" can’t be more than your max per trade.';
  return e;
}

/** Form → the on-chain Limits tuple. Call only after validateLimits returned no errors. */
export function toLimits(f: LimitsForm): Limits {
  const t = usdToUnits(f.maxTrade), d = usdToUnits(f.maxDaily), a = usdToUnits(f.askAbove);
  if (t === null || d === null || a === null) throw new Error('Enter valid amounts.');
  return { maxTradeUsd: t, maxDailyUsd: d, approvalThresholdUsd: a, maxSlippageBps: f.slippageBps, targetNgnBps: pctToBps(f.targetPct) };
}

export function sameForm(a: LimitsForm, b: LimitsForm): boolean {
  return usdToUnits(a.maxTrade) === usdToUnits(b.maxTrade) && usdToUnits(a.maxDaily) === usdToUnits(b.maxDaily) &&
    usdToUnits(a.askAbove) === usdToUnits(b.askAbove) && a.slippageBps === b.slippageBps && a.targetPct === b.targetPct;
}

export function buildSetLimits(vault: `0x${string}`, limits: Limits) {
  return { to: vault, data: tag(encodeFunctionData({ abi: vaultLimitsAbi, functionName: 'setLimits', args: [limits] })) };
}

/** Vault.setLimits(tuple) through sendTagged, then wait for the receipt (same as approve/withdraw). */
export async function sendSetLimits(owner: `0x${string}`, vault: `0x${string}`, limits: Limits): Promise<Hex> {
  const eth = getProvider();
  if (!eth) throw new Error('No wallet found.');
  const hash = await sendTagged(eth, owner, buildSetLimits(vault, limits));
  const rc = await waitForReceipt(eth, hash);
  if (rc.status !== '0x1') throw new Error('Transaction failed on-chain.');
  return hash;
}
