import { Suspense } from 'react';
import { WaitlistForm } from '../components/WaitlistForm';
import { Skeleton } from '../components/Skeleton';

/** Set when Architecture's rate script ships a real figure. Hide the card until then. */
const LOSS_NGN: number | undefined = undefined;

export default function Home() {
  return (
    <main
      style={{
        maxWidth: 480,
        margin: '0 auto',
        padding: '32px 16px 48px',
        minWidth: 320,
      }}
    >
      <p className="small" style={{ margin: '0 0 12px', color: 'var(--brand)', fontWeight: 700 }}>
        NairaGuard
      </p>
      <h1 className="h1" style={{ margin: '0 0 12px' }}>
        Stop losing money when the naira moves.
      </h1>
      <p style={{ margin: '0 0 24px', color: 'var(--ink-muted)' }}>
        An AI agent on Celo that moves your savings between cNGN and USD₮ within limits you set, and
        explains every trade in plain English.
      </p>

      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-card)',
          padding: 20,
        }}
      >
        <Suspense
          fallback={
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Skeleton height={44} />
              <Skeleton height={44} />
              <Skeleton height={44} />
            </div>
          }
        >
          <WaitlistForm lossNgn={LOSS_NGN} />
        </Suspense>
      </div>
    </main>
  );
}
