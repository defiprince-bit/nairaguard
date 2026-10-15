'use client';

import { AppShell } from '../../../components/AppShell';
import { LimitsScreen } from '../../../components/LimitsScreen';
import { VaultGate } from '../../../components/VaultGate';
import { WalletGate } from '../../../components/WalletGate';

export default function LimitsPage() {
  return (
    <WalletGate bare>
      {(address, miniPay) => (
        <AppShell title="Limits" address={address} miniPay={miniPay} variant="bare" compact>
          <VaultGate owner={address}>
            {(vault) => <LimitsScreen owner={address as `0x${string}`} vault={vault} />}
          </VaultGate>
        </AppShell>
      )}
    </WalletGate>
  );
}
