import { Button } from './Button';

export function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 12,
        borderRadius: 'var(--radius-card)',
        background: 'var(--danger-soft)',
        color: 'var(--danger)',
        border: '1px solid var(--danger-line)',
      }}
    >
      <span className="small" style={{ flex: 1 }}>
        {message}
      </span>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry} style={{ minHeight: 36, padding: '6px 12px' }}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
