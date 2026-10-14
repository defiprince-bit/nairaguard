import type { ActivityItem, ApprovalItem, Money } from './types';

/** Token units from raw 18-decimal base units (the API's amounts), for when there's no rate. */
export function tokenUnits(m: { token: 'cNGN' | 'USDT'; amount: string }) {
  let n = 0;
  try { n = Number(BigInt(m.amount)) / 1e18; } catch { /* ignore */ }
  return `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${m.token === 'cNGN' ? 'cNGN' : 'USD₮'}`;
}

/** "You rejected this · 14 Oct, 18:02" (time omitted if unknown). */
export function rejectedLabel(at: string | null | undefined) {
  if (!at) return 'You rejected this';
  const d = new Date(at);
  if (Number.isNaN(+d)) return 'You rejected this';
  return `You rejected this · ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

/** True when a Money has no usable ₦/$ values. */
export const noRate = (m?: { amountNgn: string | null; amountUsd: string | null } | null) =>
  !m || m.amountNgn == null || m.amountUsd == null;

export const EXPLORER =
  process.env.NEXT_PUBLIC_NETWORK === 'celo' ? 'https://celoscan.io' : 'https://celo-sepolia.blockscout.com';
export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;

/** "12m 05s", "1h 04m", or "Expired" for ms <= 0. */
export function formatCountdown(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'Expired';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) return `${h}h ${pad(m)}m`;
  return `${m}m ${pad(sec)}s`;
}

/** Spoken-friendly countdown for aria-live (minute granularity, so it doesn't chatter). */
export function countdownA11y(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'This approval has expired';
  const mins = Math.ceil(ms / 60_000);
  return `Expires in ${mins} minute${mins === 1 ? '' : 's'}`;
}

export const msLeft = (expiresAt: string, now = Date.now()) => new Date(expiresAt).getTime() - now;

export function formatNgn(n: number) {
  return `₦${n.toLocaleString('en-NG', { maximumFractionDigits: 0 })}`;
}
export function formatUsd(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Output of a trade: actual amountOut when the API has it, else min-out labelled "at least". */
export function tradeOut(item: ActivityItem): { money: Money; atLeast: boolean } | null {
  const a = item.amountOut;
  if (a && typeof a === 'object') return { money: a, atLeast: false };
  if (typeof a === 'string' && a !== '' && item.out) {
    if (item.out.amount === a) return { money: item.out, atLeast: false };
    const base = Number(item.out.amount);
    const ratio = base > 0 ? Number(a) / base : 0;
    return {
      money: {
        ...item.out,
        amount: a,
        amountNgn: String(Number(item.out.amountNgn) * ratio),
        amountUsd: String(Number(item.out.amountUsd) * ratio),
      },
      atLeast: false,
    };
  }
  if (item.out) return { money: item.out, atLeast: item.kind === 'swap' };
  return null;
}

/** Rate for an approval; null → "Rate unavailable". Falls back to the Money rate only when the field is absent (old API). */
export function approvalRate(a: ApprovalItem): number | null {
  if (a.rateNgnPerUsd === null) return null;
  const r = Number(a.rateNgnPerUsd ?? a.in.rate);
  // Old API used rate=1 as a placeholder when it had no quote.
  return Number.isFinite(r) && r > 1 ? r : null;
}

export type Filter = 'all' | 'executed' | 'pending' | 'failed';
export function matchesFilter(item: ActivityItem, f: Filter) {
  if (f === 'all') return true;
  if (f === 'executed') return item.status === 'confirmed';
  if (f === 'failed') return item.status === 'failed' || item.status === 'rejected';
  return item.status === f;
}

/** Group newest-first items by local day: "Today", "Yesterday", or "12 Oct". */
export function groupByDay(items: ActivityItem[], now = new Date()): { label: string; items: ActivityItem[] }[] {
  const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const today = key(now);
  const y = new Date(now); y.setDate(y.getDate() - 1);
  const yesterday = key(y);
  const out: { label: string; items: ActivityItem[] }[] = [];
  const idx = new Map<string, number>();
  for (const it of [...items].sort((a, b) => +new Date(b.at) - +new Date(a.at))) {
    const d = new Date(it.at);
    const k = key(d);
    if (!idx.has(k)) {
      idx.set(k, out.length);
      out.push({
        label: k === today ? 'Today' : k === yesterday ? 'Yesterday' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
        items: [],
      });
    }
    out[idx.get(k)!]!.items.push(it);
  }
  return out;
}

/** Prefer the per-vault lastCheckedAt over the agent's global lastRunAt. */
export function lastCheck(perVault: string | null | undefined, globalRun: string | null | undefined) {
  return perVault || globalRun || null;
}
