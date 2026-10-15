'use client';

import { ThemeToggle } from './ThemeToggle';
import { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BottomNav, NAV_ITEMS } from './BottomNav';
import { WalletChip, WalletAvatar } from './AvatarPicker';
import { WalletMenu } from './WalletMenu';
import o from './Overview.module.css';
import s from './AppShell.module.css';
import { shorten } from '../lib/wallet';

const NETWORK_LABEL = process.env.NEXT_PUBLIC_NETWORK === 'celo' ? 'Celo' : 'Celo Sepolia';

/**
 * Shared shell for the secondary tabs (Activity, Approvals, Limits).
 * ≥1000px (same breakpoint as Overview): Overview's sidebar + top bar, content in the main area.
 * Below that: the exact mobile layout these pages had before (simple header, 480px column, pill nav).
 * Use with <WalletGate bare>.
 */
export function AppShell({
  title, address, miniPay, approvalCount = 0, variant = 'list', compact, children,
}: {
  title: string;
  address: string;
  miniPay: boolean;
  approvalCount?: number;
  /** Desktop content treatment: 'list' = wide card, 'grid' = 2-column card grid, 'card' = single card, 'bare' = no wrapper card (page lays out its own cards). */
  variant?: 'list' | 'grid' | 'card' | 'bare';
  /** Mobile: the Limits page's original 16px padding instead of the list padding. */
  compact?: boolean;
  children: ReactNode;
}) {
  const path = usePathname();
  const owner = address as `0x${string}`;
  return (
    <div className={s.shell}>
      <aside className={o.side} aria-label="Sections">
        <Link href="/app" className={o.brand}><img src="/icon-v2.svg" alt="" />NairaGuard</Link>
        {NAV_ITEMS.map((n) => {
          const on = n.exact ? path === n.href : path.startsWith(n.href);
          return (
            <Link key={n.href} href={n.href} className={on ? o.sideOn : ''} aria-current={on ? 'page' : undefined}>
              {n.label}{n.badgeKey === 'approvals' && approvalCount > 0 ? ` · ${approvalCount}` : ''}
            </Link>
          );
        })}
      </aside>

      <div className={s.body}>
        {/* Mobile header (same chrome as WalletGate's default header). */}
        <header className={s.mobHead}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <img src="/logo-v2.svg" alt="" width={28} height={28} style={{ borderRadius: 8 }} />
            <strong style={{ color: 'var(--brand)' }}>NairaGuard</strong>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <ThemeToggle />
          <WalletMenu trigger={<WalletChip address={address} miniPay={miniPay} />} />
          </span>
        </header>

        {/* Desktop top bar (same as Overview). */}
        <header className={`${o.top} ${s.deskHead}`}>
          <h1 className={s.deskTitle}>{title}</h1>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <ThemeToggle />
            <span className={`${o.chip} ${o.chipLt}`}>● {NETWORK_LABEL}{miniPay ? ' · MiniPay' : ''}</span>
            <WalletMenu trigger={<WalletAvatar address={owner} title={owner} label={`Wallet ${shorten(owner)}`} />} />
          </div>
        </header>

        <main className={`${s.main} ${compact ? s.compact : ''}`}>
          <h1 className={`h1 ${s.mobTitle}`} style={compact ? undefined : { margin: '0 0 16px' }}>{title}</h1>
          <div className={`${s.content} ${s[variant]}`}>{children}</div>
        </main>
      </div>
      <BottomNav approvalCount={approvalCount} hideWide />
    </div>
  );
}
