'use client';

import { ReactNode } from 'react';
import { Button } from './Button';
import { ErrorBanner } from './ErrorBanner';
import { Skeleton } from './Skeleton';
import { shorten, useWallet } from '../lib/wallet';

export function WalletGate({ children }: { children: (address: string, miniPay: boolean) => ReactNode }) {
  const { address, miniPay, connecting, error, connect, setError } = useWallet();

  if (connecting && !address) {
    return (
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Skeleton height={24} width="40%" />
        <Skeleton height={120} />
        <Skeleton height={80} />
      </div>
    );
  }

  if (!address) {
    return (
      <div
        style={{
          maxWidth: 480,
          margin: '0 auto',
          padding: '48px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <h1 className="h1" style={{ margin: 0 }}>
          Connect your wallet
        </h1>
        <p style={{ margin: 0, color: 'var(--ink-muted)' }}>
          {miniPay
            ? 'MiniPay is ready. Tap below if your wallet did not connect automatically.'
            : 'Open this page inside MiniPay for the best experience, or connect a Celo wallet here.'}
        </p>
        {error ? <ErrorBanner message={error} onRetry={() => setError(null)} /> : null}
        {!miniPay ? (
          <Button fullWidth onClick={connect} disabled={connecting}>
            {connecting ? 'Connecting…' : 'Connect wallet'}
          </Button>
        ) : (
          <Button fullWidth onClick={connect} disabled={connecting}>
            {connecting ? 'Connecting…' : 'Retry MiniPay connect'}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: 72 }}>
      <header
        style={{
          maxWidth: 480,
          margin: '0 auto',
          padding: '12px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <img src="/logo.svg" alt="" width={28} height={28} style={{ borderRadius: 8 }} />
          <strong style={{ color: 'var(--brand)' }}>NairaGuard</strong>
        </span>
        <span className="small" style={{ color: 'var(--ink-muted)' }}>
          {miniPay ? 'MiniPay · ' : ''}
          {shorten(address)}
        </span>
      </header>
      {children(address, miniPay)}
    </div>
  );
}
