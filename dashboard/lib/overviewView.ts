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

export const CELO_MAINNET_CHAIN_ID = 42220;

/**
 * Testnet unless the vault's chain is Celo mainnet (42220). Display only.
 * `chainId` is the vault's chain (API data, else the connected wallet's chain). Any known chain
 * other than 42220 is testnet. Only when no chain ID is available yet does the build env decide,
 * and even then it is mainnet only for exactly `celo`.
 */
export function isTestnet(chainId?: number | null, network: string | undefined = process.env.NEXT_PUBLIC_NETWORK): boolean {
  if (typeof chainId === 'number' && Number.isFinite(chainId)) return chainId !== CELO_MAINNET_CHAIN_ID;
  return network !== 'celo';
}

/** The vault's chain from API payloads Overview already has (balances first, then status). Null if none carry one. */
export function vaultChainIdFrom(...payloads: unknown[]): number | null {
  for (const d of payloads) {
    const c = (d as { chainId?: unknown } | null | undefined)?.chainId;
    if (typeof c === 'number' && Number.isFinite(c)) return c;
  }
  return null;
}

/** Overview's testnet label: the vault's chain wins, then the wallet's, then the env. Only 42220 is mainnet. */
export function overviewTestnet(vaultChainId: number | null | undefined, walletChainId: number | null | undefined, network: string | undefined = process.env.NEXT_PUBLIC_NETWORK): boolean {
  return isTestnet(vaultChainId ?? walletChainId, network);
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

/** True when an API payload carries a chainId that differs from the app's configured chain (ignore that data). */
export function apiChainMismatch(data: unknown, expected: number): boolean {
  const c = (data as { chainId?: unknown } | null)?.chainId;
  return typeof c === 'number' && Number.isFinite(c) && c !== expected;
}

/** Wallet is connected on a different chain than the app's. MiniPay counts too (e.g. MiniPay testnet mode). */
export function isWrongChain(address: string | null, walletChainId: number | null, expected: number): boolean {
  return !!address && walletChainId !== null && walletChainId !== expected;
}
