'use client';

import { Overview } from '../../components/Overview';
import { VaultGate } from '../../components/VaultGate';
import { WalletGate } from '../../components/WalletGate';

export default function AppHome() {
  return <WalletGate>{(address) => <VaultGate owner={address}>{() => <Overview />}</VaultGate>}</WalletGate>;
}
