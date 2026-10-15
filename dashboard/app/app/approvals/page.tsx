'use client';

import { useState } from 'react';
import { ApprovalsList } from '../../../components/ApprovalsList';
import { AppShell } from '../../../components/AppShell';
import { VaultGate } from '../../../components/VaultGate';
import { WalletGate } from '../../../components/WalletGate';

export default function ApprovalsPage() {
  const [count, setCount] = useState(0);
  return (
    <WalletGate bare>
      {(address, miniPay) => (
        <AppShell title="Approvals" address={address} miniPay={miniPay} approvalCount={count} variant="grid">
          <VaultGate owner={address}>
            {(vault) => <ApprovalsList owner={address as `0x${string}`} vault={vault} onCount={setCount} />}
          </VaultGate>
        </AppShell>
      )}
    </WalletGate>
  );
}
