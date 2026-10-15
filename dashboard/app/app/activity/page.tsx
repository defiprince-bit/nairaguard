'use client';

import { ActivityList } from '../../../components/ActivityList';
import { AppShell } from '../../../components/AppShell';
import { VaultGate } from '../../../components/VaultGate';
import { WalletGate } from '../../../components/WalletGate';

export default function ActivityPage() {
  return (
    <WalletGate bare>
      {(address, miniPay) => (
        <AppShell title="Activity" address={address} miniPay={miniPay} variant="list">
          <VaultGate owner={address}>{(vault) => <ActivityList vault={vault} />}</VaultGate>
        </AppShell>
      )}
    </WalletGate>
  );
}
