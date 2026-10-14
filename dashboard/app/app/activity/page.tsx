'use client';

import Link from 'next/link';
import { BottomNav } from '../../../components/BottomNav';
import { WalletGate } from '../../../components/WalletGate';

export default function ActivityPage() {
  return (
    <WalletGate>
      {() => (
        <>
          <main style={{ maxWidth: 480, margin: '0 auto', padding: 16 }}>
            <h1 className="h1">Activity</h1>
            <p style={{ color: 'var(--ink-muted)' }}>
              Full activity feed comes next. For now, recent trades are on{' '}
              <Link href="/app">Overview</Link>.
            </p>
          </main>
          <BottomNav />
        </>
      )}
    </WalletGate>
  );
}
