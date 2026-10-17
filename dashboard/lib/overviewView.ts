import { formatUnits } from 'viem';
import { PRESETS, type PresetId } from './vault';

export type ApiLimits = { maxTradeUsd: string; maxDailyUsd: string; approvalThresholdUsd: string; maxSlippageBps: number; targetNgnBps: number };

/** "₦1,284,650" + ".40": whole part and grey decimals. */
export function splitAmount(n: number, cur: 'NGN' | 'USD'): { whole: string; dec: string } {
  const sym = cur === 'NGN' ? '₦' : '$';
  const fixed = (Number.isFinite(n) ? Math.abs(n) : 0).toFixed(2);
  const [w, d] = fixed.split('.') as [string, string];
  const whole = Number(w).toLocaleString('en-US');
  return { whole: `${n < 0 ? '−' : ''}${sym}${whole}`, dec: `.${d}` };
}

export const usd18 = (v: string) => Number(formatUnits(BigInt(v), 18));

/** Name the preset these on-chain limits match, else "Custom". */
export function presetFor(l: ApiLimits | null): string | null {
  if (!l) return null;
  for (const id of Object.keys(PRESETS) as PresetId[]) {
    const p = PRESETS[id].limits;
    if (
      p.maxTradeUsd.toString() === l.maxTradeUsd && p.maxDailyUsd.toString() === l.maxDailyUsd &&
      p.approvalThresholdUsd.toString() === l.approvalThresholdUsd && p.maxSlippageBps === l.maxSlippageBps
    ) return PRESETS[id].label;
  }
  return 'Custom';
}

/** P&L as a % of what plain naira would be worth now (value − pnl). Null when not computable. */
export function pnlPct(pnlNgn: number, valueNgn: number): number | null {
  const base = valueNgn - pnlNgn;
  if (!(base > 0) || !Number.isFinite(pnlNgn)) return null;
  return (pnlNgn / base) * 100;
}

/** True unless the app is built for Celo mainnet (NEXT_PUBLIC_NETWORK=celo). Display only. */
export function isTestnet(network: string | undefined = process.env.NEXT_PUBLIC_NETWORK): boolean {
  return network !== 'celo';
}

/** stroke-dasharray for a share (0–100) of a circle of radius r. */
export function ringDash(pct: number, r: number): string {
  const c = 2 * Math.PI * r;
  const p = Math.min(100, Math.max(0, pct));
  return `${((p / 100) * c).toFixed(1)} ${c.toFixed(1)}`;
}

export function signedMoney(n: number, cur: 'NGN' | 'USD') {
  const { whole, dec } = splitAmount(Math.abs(n), cur);
  return `${n >= 0 ? '+' : '−'}${whole}${cur === 'USD' ? dec : ''}`;
}

export function initials(addr: string) {
  return addr.slice(2, 4).toUpperCase();
}
