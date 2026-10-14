import type { FriendlyError } from '../lib/errors';

/** Inline, in-card message. 'cancelled' is neutral, not an error. */
export function InlineMessage({ err, onDismiss }: { err: FriendlyError; onDismiss?: () => void }) {
  const cancelled = err.kind === 'cancelled';
  return (
    <div
      role={cancelled ? 'status' : 'alert'}
      style={{
        display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 12px', borderRadius: 12,
        background: cancelled ? 'var(--tile, #f5f7f6)' : 'var(--danger-soft)',
        color: cancelled ? 'var(--ink-muted)' : 'var(--danger)',
        border: `1px solid ${cancelled ? 'var(--border)' : '#f3c4c0'}`,
      }}
    >
      <span className="small" style={{ flex: 1 }}>{err.message}</span>
      {onDismiss ? (
        <button type="button" onClick={onDismiss} aria-label="Dismiss"
          style={{ background: 'none', border: 0, color: 'inherit', cursor: 'pointer', fontSize: 16 }}>×</button>
      ) : null}
    </div>
  );
}
