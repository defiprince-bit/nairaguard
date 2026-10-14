import { AmountText } from './AmountText';
import { StatusChip } from './StatusChip';
import type { ActivityItem } from '../lib/types';

function mapStatus(s: ActivityItem['status']): 'pending' | 'executed' | 'failed' {
  if (s === 'confirmed') return 'executed';
  if (s === 'failed') return 'failed';
  return 'pending';
}

function title(item: ActivityItem) {
  if (item.kind === 'deposit') return 'Deposited';
  if (item.kind === 'withdraw') return 'Withdrew';
  const from = item.in?.token === 'cNGN' ? '₦' : '$';
  const to = item.out?.token === 'cNGN' ? '₦' : '$';
  return `Swapped ${from} → ${to}`;
}

function timeLabel(iso: string) {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function TradeRow({ item }: { item: ActivityItem }) {
  const celoscan = `https://celoscan.io/tx/${item.txHash}`;
  return (
    <a
      href={celoscan}
      target="_blank"
      rel="noreferrer"
      style={{
        display: 'block',
        textDecoration: 'none',
        color: 'inherit',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-card)',
        padding: 14,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <strong className="h2" style={{ margin: 0, fontSize: 15 }}>
          {title(item)}
        </strong>
        <StatusChip status={mapStatus(item.status)} />
      </div>
      {item.in && item.out ? (
        <div style={{ display: 'flex', gap: 16, marginBottom: 6 }}>
          <AmountText
            amountNgn={Number(item.in.amountNgn)}
            amountUsd={Number(item.in.amountUsd)}
            size="small"
          />
          <span className="small" style={{ color: 'var(--ink-muted)', alignSelf: 'center' }}>
            →
          </span>
          <AmountText
            amountNgn={Number(item.out.amountNgn)}
            amountUsd={Number(item.out.amountUsd)}
            size="small"
          />
        </div>
      ) : item.in ? (
        <div style={{ marginBottom: 6 }}>
          <AmountText
            amountNgn={Number(item.in.amountNgn)}
            amountUsd={Number(item.in.amountUsd)}
            size="small"
          />
        </div>
      ) : null}
      <p className="small" style={{ margin: '0 0 6px', color: 'var(--ink-muted)' }}>
        {item.reason}
      </p>
      <p className="small" style={{ margin: 0, color: 'var(--ink-muted)' }}>
        {timeLabel(item.at)}
      </p>
    </a>
  );
}
