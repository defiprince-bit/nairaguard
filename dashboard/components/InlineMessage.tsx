import type { FriendlyError } from '../lib/errors';

type Msg = FriendlyError | { kind: 'exists' | 'pending'; message: string };

/** Inline, in-card message. 'cancelled', 'exists' and 'pending' are neutral, not errors. */
export function InlineMessage({ err, onDismiss }: { err: Msg; onDismiss?: () => void }) {
  const cancelled = err.kind !== 'error';
  return (
    <div
      role={cancelled ? 'status' : 'alert'}
      aria-live={err.kind === 'pending' ? 'polite' : undefined}
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
