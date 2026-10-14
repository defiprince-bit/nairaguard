'use client';

import { useEffect, useState } from 'react';
import { AmountText } from './AmountText';
import { Button } from './Button';
import { StatusChip } from './StatusChip';
import { approvalRate, countdownA11y, formatCountdown, formatUsd, msLeft, txUrl } from '../lib/format';
import type { ApprovalItem, Money } from '../lib/types';

export type TxState = { kind: 'idle' } | { kind: 'waiting' } | { kind: 'ok'; hash: string } | { kind: 'error'; message: string };

function Amount({ m, rate }: { m: Money; rate: number | null }) {
  if (rate === null) {
    // No naira figure without a rate: show the dollar side only.
    const usd = m.token === 'USDT' ? Number(m.amountUsd) : null;
    return (
      <span className="small tabular" style={{ fontWeight: 600 }}>
        {usd !== null ? formatUsd(usd) : `${m.token === 'cNGN' ? 'cNGN' : 'USD₮'}`}
      </span>
    );
  }
  const ngn = m.token === 'cNGN' ? Number(m.amountNgn) : Number(m.amountUsd) * rate;
  const usd = m.token === 'USDT' ? Number(m.amountUsd) : Number(m.amountNgn) / rate;
  return <AmountText amountNgn={ngn} amountUsd={usd} size="small" rate={rate} rateAt={m.rateAt} />;
}

export function ApprovalCard({
  item, tx, onApprove, onReject,
}: { item: ApprovalItem; tx: TxState; onApprove: () => void; onReject: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = msLeft(item.expiresAt, now);
  const expired = left <= 0;
  const rate = approvalRate(item);
  const busy = tx.kind === 'waiting';
  const dir = `${item.in.token === 'cNGN' ? '₦' : '$'} → ${item.minOut.token === 'cNGN' ? '₦' : '$'}`;

  return (
    <article
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-card)',
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <strong className="h2" style={{ margin: 0, fontSize: 15 }}>Swap {dir}</strong>
        <StatusChip status={tx.kind === 'ok' ? 'executed' : expired ? 'expired' : 'pending'} />
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Amount m={item.in} rate={rate} />
        <span className="small" style={{ color: 'var(--ink-muted)' }}>→ at least</span>
        <Amount m={item.minOut} rate={rate} />
      </div>
      {rate === null ? (
        <p className="small" style={{ margin: 0, color: 'var(--warn)' }}>Rate unavailable</p>
      ) : null}
      <p className="small" style={{ margin: 0, color: 'var(--ink)' }}>{item.reason}</p>
      <p className="small tabular" style={{ margin: 0, color: expired ? 'var(--ink-muted)' : 'var(--warn)', fontWeight: 600 }}>
        <span aria-hidden>{expired ? 'Expired' : `Expires in ${formatCountdown(left)}`}</span>
        <span aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
          {countdownA11y(left)}
        </span>
      </p>
      {tx.kind !== 'ok' ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <Button fullWidth onClick={onApprove} disabled={expired || busy}>
            {busy ? 'Waiting for wallet…' : 'Approve'}
          </Button>
          <Button fullWidth variant="secondary" onClick={onReject} disabled={expired || busy}>
            Reject
          </Button>
        </div>
      ) : null}
      {tx.kind === 'ok' ? (
        <p role="status" className="small" style={{ margin: 0, color: 'var(--brand)', fontWeight: 600 }}>
          Approved ✓ ·{' '}
          <a href={txUrl(tx.hash)} target="_blank" rel="noreferrer">View on explorer ↗</a>
        </p>
      ) : null}
      {tx.kind === 'error' ? (
        <p role="alert" className="small" style={{ margin: 0, color: 'var(--danger)' }}>{tx.message}</p>
      ) : null}
    </article>
  );
}
