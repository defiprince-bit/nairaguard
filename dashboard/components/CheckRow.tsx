import { StatusChip } from './StatusChip';
import type { ActivityItem } from '../lib/types';
import { checkRange, checkReason, checkTitle, quoteOutcomeLine } from '../lib/format';

/**
 * An agent check that didn't trade (kind 'check'): plain-English reason, time or time range, neutral "Checked"
 * chip. No swap arrows, amounts, rate or explorer link, because nothing moved. Same card chrome as TradeRow.
 */
export function CheckRow({ item }: { item: ActivityItem }) {
  const outcome = quoteOutcomeLine(item.outcome);
  return (
    <div
      data-testid="check-row"
      style={{
        display: 'block',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-card)',
        padding: 14,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <strong className="h2" style={{ margin: 0, fontSize: 16 }}>{checkTitle(item)}</strong>
        <StatusChip status="checked" />
      </div>
      {item.reason ? (
        <p className="small" style={{ margin: '0 0 6px', color: 'var(--ink-muted)' }}>{checkReason(item.reason)}</p>
      ) : null}
      {outcome && outcome !== item.reason ? (
        <p className="small" style={{ margin: '0 0 6px', color: 'var(--ink-muted)' }}>{outcome}</p>
      ) : null}
      <p className="small" style={{ margin: 0, color: 'var(--ink-muted)' }}>{checkRange(item)}</p>
    </div>
  );
}
