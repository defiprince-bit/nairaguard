'use client';

import { Overview } from '../../components/Overview';
import { VaultGate } from '../../components/VaultGate';
import { WalletGate } from '../../components/WalletGate';

export default function AppHome() {
  return (
    <WalletGate bare>
      {(address, miniPay) => (
        <VaultGate owner={address}>
          {(vault) => <Overview vault={vault} owner={address as `0x${string}`} miniPay={miniPay} />}
        </VaultGate>
      )}
    </WalletGate>
  );
}
