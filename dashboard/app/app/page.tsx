'use client';

import { Overview } from '../../components/Overview';
import { WalletGate } from '../../components/WalletGate';

export default function AppHome() {
  return <WalletGate>{() => <Overview />}</WalletGate>;
}
