'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import s from './BottomNav.module.css';

export const NAV_ITEMS = [
  { href: '/app', label: 'Overview', exact: true },
  { href: '/app/activity', label: 'Activity' },
  { href: '/app/approvals', label: 'Approvals', badgeKey: 'approvals' as const },
  { href: '/app/limits', label: 'Limits' },
];

export function BottomNav({ approvalCount = 0, hideWide }: { approvalCount?: number; /** Hide at ≥1000px where a sidebar is shown. */ hideWide?: boolean }) {
  const path = usePathname();
  return (
    <nav className={`${s.nav} ${hideWide ? s.hideWide : ''}`} aria-label="Main">
      <div className={s.inner}>
        {NAV_ITEMS.map((item) => {
          const active = item.exact ? path === item.href : path.startsWith(item.href);
          const n = item.badgeKey === 'approvals' ? approvalCount : 0;
          return (
            <Link key={item.href} href={item.href} className={`${s.item} ${active ? s.on : ''}`} aria-current={active ? 'page' : undefined}>
              {item.label}
              {n > 0 ? <span className={s.badge} aria-label={`${n} waiting`}>{n}</span> : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
