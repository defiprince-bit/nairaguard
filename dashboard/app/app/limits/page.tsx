'use client';

import { BottomNav } from '../../../components/BottomNav';
import { WalletGate } from '../../../components/WalletGate';

export default function LimitsPage() {
  return (
    <WalletGate>
      {() => (
        <>
          <main style={{ maxWidth: 480, margin: '0 auto', padding: 16 }}>
            <h1 className="h1">Limits</h1>
            <p style={{ color: 'var(--ink-muted)' }}>
              Limit controls and the target-mix slider land in the next UI PR.
            </p>
          </main>
          <BottomNav />
        </>
      )}
    </WalletGate>
  );
}
