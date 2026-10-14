'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const items = [
  { href: '/app', label: 'Overview', exact: true },
  { href: '/app/activity', label: 'Activity' },
  { href: '/app/approvals', label: 'Approvals', badgeKey: 'approvals' as const },
  { href: '/app/limits', label: 'Limits' },
];

export function BottomNav({ approvalCount = 0 }: { approvalCount?: number }) {
  const path = usePathname();
  return (
    <nav
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        background: 'var(--surface)',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'center',
        zIndex: 20,
      }}
    >
      <div
        style={{
          maxWidth: 480,
          width: '100%',
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
        }}
      >
        {items.map((item) => {
          const active = item.exact ? path === item.href : path.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                textDecoration: 'none',
                color: active ? 'var(--brand)' : 'var(--ink-muted)',
                fontWeight: active ? 700 : 500,
                fontSize: 12,
                lineHeight: '16px',
                padding: '10px 4px 12px',
                textAlign: 'center',
                minHeight: 44,
                position: 'relative',
              }}
            >
              {item.label}
              {item.badgeKey === 'approvals' && approvalCount > 0 ? (
                <span
                  style={{
                    position: 'absolute',
                    top: 6,
                    right: '18%',
                    minWidth: 16,
                    height: 16,
                    borderRadius: 999,
                    background: 'var(--danger)',
                    color: '#fff',
                    fontSize: 10,
                    lineHeight: '16px',
                    padding: '0 4px',
                  }}
                >
                  {approvalCount}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
