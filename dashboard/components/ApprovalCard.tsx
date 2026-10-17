'use client';

import { useEffect, useState } from 'react';
import { AmountText } from './AmountText';
import { Button } from './Button';
import { StatusChip } from './StatusChip';
import { REJECT_HELPER } from '../lib/approve';
import { APPROVE_HELPER, approvalRate, approvalView, countdownA11y, formatCountdown, msLeft, rejectedLabel, tokenUnits, txUrl } from '../lib/format';
import type { ApprovalItem, Money } from '../lib/types';

export type TxState =
  | { kind: 'idle' }
  | { kind: 'waiting'; action: 'approve' | 'reject' }
  | { kind: 'ok'; hash: string }
  | { kind: 'rejected'; hash: string }
  | { kind: 'error'; message: string }
  | { kind: 'cancelled'; message: string };

function Amount({ m, rate }: { m: Money; rate: number | null }) {
  if (rate === null) {
    // No rate: token units only, never a naira figure.
    return <span className="small tabular" style={{ fontWeight: 600 }}>{tokenUnits(m)}</span>;
  }
  const ngn = m.token === 'cNGN' ? Number(m.amountNgn) : Number(m.amountUsd) * rate;
  const usd = m.token === 'USDT' ? Number(m.amountUsd) : Number(m.amountNgn) / rate;
  return <AmountText amountNgn={ngn} amountUsd={usd} size="small" rate={rate} rateAt={m.rateAt ?? undefined} />;
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
  // Task 8b: approve opens a 30-min window; the agent trades only at the floor or better.
  const view = approvalView(item, now);
  const settled = view.state === 'approved' || view.state === 'executed';
  const expired = view.state === 'expired';
  const rate = approvalRate(item);
  const busy = tx.kind === 'waiting';
  const rejected = tx.kind === 'rejected' || item.status === 'rejected';
  const done = tx.kind === 'ok' || rejected || settled || expired;
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
        <strong className="h2" style={{ margin: 0, fontSize: 16 }}>Swap {dir}</strong>
        <StatusChip status={tx.kind === 'ok' || view.state === 'approved' ? 'approved' : view.state === 'executed' ? 'executed' : rejected ? 'rejected' : expired ? 'expired' : 'pending'} />
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Amount m={item.in} rate={rate} />
        <span className="small" style={{ color: 'var(--ink-muted)' }}>→ at least</span>
        <Amount m={item.minOut} rate={rate} />
      </div>
      {rate === null ? (
        <p className="small" style={{ margin: 0, color: 'var(--warn)' }}>Rate unavailable</p>
      ) : null}
      {!rejected ? (
        <p className="small tabular" role="status" style={{ margin: 0, fontWeight: 600, color: view.tone === 'brand' ? 'var(--brand)' : view.tone === 'warn' ? 'var(--ink)' : 'var(--ink-muted)' }}>
          {view.line}
          {view.state === 'executed' && item.executedTx ? <> · <a href={txUrl(item.executedTx)} target="_blank" rel="noreferrer">View on explorer ↗</a></> : null}
        </p>
      ) : null}
      <p className="small" style={{ margin: 0, color: 'var(--ink)' }}>{item.reason}</p>
      {!done && !expired ? <p className="small" style={{ margin: 0, color: 'var(--ink-muted)' }}>{APPROVE_HELPER}</p> : null}
      {rejected ? (
        <p role="status" className="small" style={{ margin: 0, color: 'var(--ink-muted)', fontWeight: 600 }}>
          {rejectedLabel(tx.kind === 'rejected' ? new Date(now).toISOString() : item.rejectedAt)}
        </p>
      ) : null}
      {tx.kind === 'rejected' ? (
        <p className="small" style={{ margin: 0, color: 'var(--ink)' }}>
          {REJECT_HELPER}{' '}
          <a href={txUrl(tx.hash)} target="_blank" rel="noreferrer">View on explorer ↗</a>
        </p>
      ) : null}
      {!done ? <p className="small tabular" style={{ margin: 0, color: expired ? 'var(--ink-muted)' : 'var(--warn)', fontWeight: 600 }}>
        <span aria-hidden>{expired ? 'Expired' : `Expires in ${formatCountdown(left)}`}</span>
        <span aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
          {countdownA11y(left)}
        </span>
      </p> : null}
      {!done ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <Button fullWidth onClick={onApprove} disabled={expired || busy}>
            {busy && tx.action === 'approve' ? 'Waiting for wallet…' : 'Approve'}
          </Button>
          <Button fullWidth variant="secondary" onClick={onReject} disabled={expired || busy}>
            {busy && tx.action === 'reject' ? 'Waiting for wallet…' : 'Reject'}
          </Button>
        </div>
      ) : null}
      {tx.kind === 'ok' ? (
        <p role="status" className="small" style={{ margin: 0, color: 'var(--brand)', fontWeight: 600 }}>
          Approved ✓ · trading window open for 30 min ·{' '}
          <a href={txUrl(tx.hash)} target="_blank" rel="noreferrer">View on explorer ↗</a>
        </p>
      ) : null}
      {tx.kind === 'cancelled' ? (
        <p role="status" className="small" style={{ margin: 0, color: 'var(--ink-muted)' }}>{tx.message}</p>
      ) : null}
      {tx.kind === 'error' ? (
        <p role="alert" className="small" style={{ margin: 0, color: 'var(--danger)' }}>{tx.message}</p>
      ) : null}
    </article>
  );
}
