export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div
      style={{
        padding: 24,
        textAlign: 'center',
        border: '1px dashed var(--border)',
        borderRadius: 'var(--radius-card)',
        background: 'var(--surface)',
      }}
    >
      <p className="h2" style={{ margin: '0 0 4px' }}>{title}</p>
      {body ? <p className="small" style={{ margin: 0, color: 'var(--ink-muted)' }}>{body}</p> : null}
    </div>
  );
}
