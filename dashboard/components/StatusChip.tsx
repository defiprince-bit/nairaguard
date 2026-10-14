type Status = 'pending' | 'executed' | 'failed' | 'expired';

const map: Record<Status, { label: string; bg: string; fg: string }> = {
  pending: { label: 'Pending', bg: 'var(--warn-soft)', fg: 'var(--warn)' },
  executed: { label: 'Executed', bg: 'var(--brand-soft)', fg: 'var(--brand)' },
  failed: { label: 'Failed', bg: 'var(--danger-soft)', fg: 'var(--danger)' },
  expired: { label: 'Expired', bg: 'var(--border)', fg: 'var(--ink-muted)' },
};

export function StatusChip({ status }: { status: Status }) {
  const s = map[status];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        minHeight: 24,
        padding: '2px 10px',
        borderRadius: 999,
        background: s.bg,
        color: s.fg,
        fontSize: 13,
        lineHeight: '18px',
        fontWeight: 600,
      }}
    >
      {s.label}
    </span>
  );
}
