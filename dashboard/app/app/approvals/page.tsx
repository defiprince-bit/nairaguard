'use client';

import { BottomNav } from '../../../components/BottomNav';
import { WalletGate } from '../../../components/WalletGate';

export default function ApprovalsPage() {
  return (
    <WalletGate>
      {() => (
        <>
          <main style={{ maxWidth: 480, margin: '0 auto', padding: 16 }}>
            <h1 className="h1">Approvals</h1>
            <p style={{ color: 'var(--ink-muted)' }}>
              Approval cards with countdown and wallet signing land in the next UI PR.
            </p>
          </main>
          <BottomNav />
        </>
      )}
    </WalletGate>
  );
}
