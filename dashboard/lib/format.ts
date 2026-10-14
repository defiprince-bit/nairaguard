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

// ---- Task 8b ----

const rateText = (r: number) => `₦${r.toLocaleString('en-US', { maximumFractionDigits: 0 })}/$`;

/**
 * The user's limit in ₦ per $1 from the approval's floor (approvedMinOut, else minOut).
 * Uses the ₦ leg (cNGN is 1:1 naira) and the $ leg (USD₮ ≈ $1), so no token decimals are needed.
 */
export function floorRate(a: Pick<ApprovalItem, 'in' | 'minOut' | 'approvedMinOut'>): number | null {
  const scale = (() => {
    if (!a.approvedMinOut || a.approvedMinOut === a.minOut.amount) return 1;
    try { const b = Number(BigInt(a.minOut.amount)); return b > 0 ? Number(BigInt(a.approvedMinOut)) / b : 1; } catch { return 1; }
  })();
  let ngn: number, usd: number;
  if (a.in.token === 'cNGN') { ngn = Number(a.in.amountNgn); usd = Number(a.minOut.amountUsd) * scale; }
  else { ngn = Number(a.minOut.amountNgn) * scale; usd = Number(a.in.amountUsd); }
  if (a.in.amountNgn == null && a.in.token === 'cNGN') return null;
  const r = ngn / usd;
  return Number.isFinite(r) && r > 0 ? r : null;
}

export type ApprovalView = { state: 'pending' | 'approved' | 'executed' | 'expired' | 'rejected'; line: string; tone: 'warn' | 'brand' | 'muted' };

/** One line per approval state (Approvals card + Overview banner). Expired is neutral, never an error. */
export function approvalView(a: ApprovalItem, now = Date.now()): ApprovalView {
  const raw = a.status ?? 'pending';
  const left = msLeft(a.expiresAt, now);
  const state = (raw === 'pending' || raw === 'approved') && left <= 0 ? 'expired' : raw;
  const f = floorRate(a);
  const lim = f ? rateText(f) : null;
  const toUsd = a.minOut.token === 'USDT';
  switch (state) {
    case 'pending': {
      const usd = a.in.amountUsd != null ? `~$${Number(a.in.amountUsd).toFixed(0)}` : tokenUnits(a.in);
      return { state, tone: 'warn', line: `Swap ${usd} to ${toUsd ? 'USD₮' : 'cNGN'}${lim ? ` · at ${lim} or better` : ' · Rate unavailable'}` };
    }
    case 'approved':
      return { state, tone: 'brand', line: `Approved · trading within ${formatCountdown(left)}${lim ? ` at ${lim} or better` : ''}` };
    case 'executed': {
      const r = Number(a.rateNgnPerUsd);
      return { state, tone: 'brand', line: Number.isFinite(r) && r > 1 ? `Traded at ${rateText(r)}` : 'Traded' };
    }
    case 'expired':
      return { state, tone: 'muted', line: a.approvedAt ? "Didn't trade, price never reached your limit" : 'Expired, nothing was traded' };
    default:
      return { state: 'rejected', tone: 'muted', line: rejectedLabel(a.rejectedAt) };
  }
}

export const APPROVE_HELPER = 'Approving gives the agent 30 minutes to trade at your limit or better. If the price never gets there, nothing trades.';

/** "via Textile FX" / "via Celo pool" / "via <label>"; Sepolia → "Test swap (mock exchange)". */
export function venueLine(venue: string | null | undefined, network = process.env.NEXT_PUBLIC_NETWORK): string | null {
  if (network !== 'celo') return venue === undefined ? null : 'Test swap (mock exchange)';
  if (!venue) return null;
  const v = venue.toLowerCase();
  if (v === 'textile' || v === 'textile-fx') return 'via Textile FX';
  if (v.includes('pool') || v === 'celo-pool' || v === 'dex') return 'via Celo pool';
  return `via ${venue}`;
}

/** Quote outcomes shown quietly (never as errors). Unknown → null. */
export function quoteOutcomeLine(outcome: string | null | undefined): string | null {
  if (outcome === 'price_moved') return "Price moved, didn't trade";
  if (outcome === 'no_quote') return 'No offer from the exchange right now. Will try again next check.';
  return null;
}

/** "Official rate ₦1,330/$ · updated 3 min ago". */
export function officialRateLine(feedRate: string | null | undefined, updatedAt?: string | null, now = Date.now()): string | null {
  const r = Number(feedRate);
  if (!feedRate || !Number.isFinite(r) || r <= 0) return null;
  let when = '';
  if (updatedAt) {
    const mins = Math.round((now - new Date(updatedAt).getTime()) / 60_000);
    if (Number.isFinite(mins)) when = mins < 60 ? ` · updated ${Math.max(1, mins)} min ago` : ` · updated ${Math.round(mins / 60)}h ago`;
  }
  return `Official rate ${rateText(r)}${when}`;
}

export const STALE_PRICE = 'Paused, waiting for a fresh naira price.';
export const OWNER_PAUSED = 'Paused by you. The agent won\u2019t trade until you unpause.';
export function pausedLine(p: 'owner' | 'stale_price' | null | undefined): string | null {
  return p === 'stale_price' ? STALE_PRICE : p === 'owner' ? OWNER_PAUSED : null;
}

export const MIN_TRADE_USD = 1;
export const MIN_TRADE_HINT = 'Smallest trade is about $1.';
export function perTradeError(v: string): string | null {
  const n = Number(v);
  if (v.trim() === '' || !Number.isFinite(n)) return 'Enter an amount in dollars.';
  if (n < MIN_TRADE_USD) return MIN_TRADE_HINT;
  return null;
}
