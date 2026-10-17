import { AmountText } from './AmountText';
import { StatusChip } from './StatusChip';
import type { ActivityItem } from '../lib/types';
import { noRate, quoteOutcomeLine, rejectedLabel, tradeOut, txUrl, venueLine } from '../lib/format';


function mapStatus(s: ActivityItem['status']): 'pending' | 'executed' | 'failed' | 'rejected' {
  if (s === 'confirmed') return 'executed';
  if (s === 'rejected') return 'rejected';
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
  const celoscan = txUrl(item.txHash);
  const out = tradeOut(item);
  return (
    <a
      href={item.txHash ? celoscan : undefined}
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
        <strong className="h2" style={{ margin: 0, fontSize: 16 }}>
          {title(item)}
        </strong>
        <StatusChip status={mapStatus(item.status)} />
      </div>
      {(item.kind === 'swap' && (noRate(item.in) || (out && noRate(out.money)))) || (item.kind !== 'swap' && noRate(item.in ?? item.out)) ? (
        <p className="small" style={{ margin: '0 0 6px', color: 'var(--warn)', fontWeight: 600 }}>Rate unavailable</p>
      ) : item.in && out ? (
        <div style={{ display: 'flex', gap: 16, marginBottom: 6 }}>
          <AmountText
            amountNgn={Number(item.in.amountNgn)}
            amountUsd={Number(item.in.amountUsd)}
            size="small"
          />
          <span className="small" style={{ color: 'var(--ink-muted)', alignSelf: 'center' }}>
            →
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
            {out.atLeast ? (
              <span className="small" style={{ color: 'var(--ink-muted)' }}>at least</span>
            ) : null}
            <AmountText
              amountNgn={Number(out.money.amountNgn)}
              amountUsd={Number(out.money.amountUsd)}
              size="small"
            />
          </span>
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
      {item.kind === 'swap' && item.status === 'confirmed' && venueLine(item.venue) ? (
        <p className="small" style={{ margin: '0 0 6px', color: 'var(--ink-muted)', fontSize: 12 }}>{venueLine(item.venue)}</p>
      ) : null}
      {quoteOutcomeLine(item.outcome) ? (
        <p className="small" style={{ margin: '0 0 6px', color: 'var(--ink-muted)' }}>{quoteOutcomeLine(item.outcome)}</p>
      ) : null}
      <p className="small" style={{ margin: 0, color: 'var(--ink-muted)' }}>
        {item.status === 'rejected' ? rejectedLabel(item.at) : timeLabel(item.at)}
        {item.txHash ? <> · <span style={{ textDecoration: 'underline' }}>View on explorer ↗</span></> : null}
      </p>
    </a>
  );
}
