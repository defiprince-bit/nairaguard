'use client';

import { ActivityList } from '../../../components/ActivityList';
import { BottomNav } from '../../../components/BottomNav';
import { VaultGate } from '../../../components/VaultGate';
import { WalletGate } from '../../../components/WalletGate';

export default function ActivityPage() {
  return (
    <WalletGate>
      {(address) => (
        <>
          <main style={{ maxWidth: 480, margin: '0 auto', padding: '8px 16px 96px' }}>
            <h1 className="h1" style={{ margin: '0 0 16px' }}>Activity</h1>
            <VaultGate owner={address}>{(vault) => <ActivityList vault={vault} />}</VaultGate>
          </main>
          <BottomNav />
        </>
      )}
    </WalletGate>
  );
}
