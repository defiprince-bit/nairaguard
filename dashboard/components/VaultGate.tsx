'use client';

import { ReactNode, useEffect, useState } from 'react';
import { ErrorBanner } from './ErrorBanner';
import { Skeleton } from './Skeleton';
import { CreateVaultStep, DepositStep } from './CreateVault';
import { FACTORY_ADDRESS, lookupVault } from '../lib/vault';

/** Finds the user's vault with factory.vaultOf(owner); 0x0 → onboarding (create, then deposit). */
export function VaultGate({ owner, children }: { owner: string; children: (vault: `0x${string}`) => ReactNode }) {
  const [vault, setVault] = useState<`0x${string}` | null | undefined>(undefined);
  const [step, setStep] = useState<'ready' | 'deposit'>('ready');
  const [error, setError] = useState<string | null>(null);
  const factory = FACTORY_ADDRESS;

  useEffect(() => {
    if (!factory) return;
    lookupVault(factory, owner as `0x${string}`)
      .then(setVault)
      .catch(() => setError('Could not look up your vault. Check your connection and try again.'));
  }, [factory, owner]);

  if (!factory) return <ErrorBanner message="Vaults are not open yet." />;
  if (error) return <ErrorBanner message={error} onRetry={() => location.reload()} />;
  if (vault === undefined) return <div style={{ padding: 16 }}><Skeleton height={120} /></div>;
  if (vault === null) {
    return <CreateVaultStep owner={owner as `0x${string}`} factory={factory}
      onCreated={(v) => { setVault(v); setStep('deposit'); }} />;
  }
  if (step === 'deposit') {
    return <DepositStep owner={owner as `0x${string}`} factory={factory} vault={vault} onDone={() => setStep('ready')} />;
  }
  return <>{children(vault)}</>;
}
