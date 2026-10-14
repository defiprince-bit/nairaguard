'use client';

import { useState } from 'react';
import { ApprovalsList } from '../../../components/ApprovalsList';
import { BottomNav } from '../../../components/BottomNav';
import { VaultGate } from '../../../components/VaultGate';
import { WalletGate } from '../../../components/WalletGate';

export default function ApprovalsPage() {
  const [count, setCount] = useState(0);
  return (
    <WalletGate>
      {(address) => (
        <>
          <main style={{ maxWidth: 480, margin: '0 auto', padding: '8px 16px 96px' }}>
            <h1 className="h1" style={{ margin: '0 0 16px' }}>Approvals</h1>
            <VaultGate owner={address}>
              {(vault) => <ApprovalsList owner={address as `0x${string}`} vault={vault} onCount={setCount} />}
            </VaultGate>
          </main>
          <BottomNav approvalCount={count} />
        </>
      )}
    </WalletGate>
  );
}
