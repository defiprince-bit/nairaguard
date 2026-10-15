'use client';

import { AppShell } from '../../../components/AppShell';
import { WalletGate } from '../../../components/WalletGate';

export default function LimitsPage() {
  return (
    <WalletGate bare>
      {(address, miniPay) => (
        <AppShell title="Limits" address={address} miniPay={miniPay} variant="card" compact>
          <p style={{ color: 'var(--ink-muted)' }}>
            Limit controls and the target-mix slider land in the next UI PR.
          </p>
        </AppShell>
      )}
    </WalletGate>
  );
}
