'use client';

import { useEffect, useState } from 'react';
import { ApprovalCard, type TxState } from './ApprovalCard';
import { EmptyState } from './EmptyState';
import { ErrorBanner } from './ErrorBanner';
import { Skeleton } from './Skeleton';
import { sendApproveSwap, sendRejectSwap } from '../lib/approve';
import { getJson } from '../lib/overview';
import type { ApprovalItem } from '../lib/types';

export function friendly(e: unknown): string {
  const err = e as { code?: number; shortMessage?: string; message?: string; name?: string };
  if (err.code === 4001 || err.name === 'UserRejectedRequestError' || /reject|denied/i.test(err.message ?? '')) {
    return 'You cancelled in your wallet. Nothing was traded.';
  }
  const msg = err.shortMessage ?? err.message ?? '';
  if (/ApprovalRejected/.test(msg)) return 'You already rejected this trade.';
  if (/ApprovalExpired/.test(msg)) return 'This approval expired before it went through.';
  if (/DailyLimitExceeded/.test(msg)) return 'This would go over your daily limit, so it was not sent.';
  if (/TradeTooLarge/.test(msg)) return 'This is above your per-trade limit, so it was not sent.';
  return 'The approval failed. Nothing was traded. Try again in a moment.';
}

export function ApprovalsList({ owner, vault, onCount }: { owner: `0x${string}`; vault: `0x${string}`; onCount?: (n: number) => void }) {
  const [items, setItems] = useState<ApprovalItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tx, setTx] = useState<Record<string, TxState>>({});

  async function load() {
    setError(null);
    setItems(null);
    try {
      const r = await getJson<{ items: ApprovalItem[] }>(`vault/${vault.toLowerCase()}/approvals`);
      if (!r.ok) throw new Error(String(r.status));
      setItems([...(r.data?.items ?? [])].sort((a, b) => (a.status === 'rejected' ? 1 : 0) - (b.status === 'rejected' ? 1 : 0) || +new Date(a.expiresAt) - +new Date(b.expiresAt)));
    } catch {
      setError('Could not load approvals. Try again.');
      setItems([]);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault]);

  const visible = items ?? [];
  const pendingCount = visible.filter((i) => i.status !== 'rejected' && tx[i.id]?.kind !== 'ok' && tx[i.id]?.kind !== 'rejected').length;
  useEffect(() => { onCount?.(pendingCount); }, [pendingCount, onCount]);

  async function approve(item: ApprovalItem) {
    setTx((t) => ({ ...t, [item.id]: { kind: 'waiting', action: 'approve' } }));
    try {
      const hash = await sendApproveSwap(owner, vault, BigInt(item.id));
      setTx((t) => ({ ...t, [item.id]: { kind: 'ok', hash } }));
    } catch (e) {
      setTx((t) => ({ ...t, [item.id]: { kind: 'error', message: friendly(e) } }));
    }
  }

  async function reject(item: ApprovalItem) {
    setTx((t) => ({ ...t, [item.id]: { kind: 'waiting', action: 'reject' } }));
    try {
      const hash = await sendRejectSwap(owner, vault, BigInt(item.id));
      setTx((t) => ({ ...t, [item.id]: { kind: 'rejected', hash } }));
    } catch (e) {
      setTx((t) => ({ ...t, [item.id]: { kind: 'error', message: friendly(e) } }));
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error ? <ErrorBanner message={error} onRetry={load} /> : null}
      {items === null ? (
        <><Skeleton height={200} /><Skeleton height={200} /></>
      ) : (
        <>
        {!error && pendingCount === 0 ? (
          <EmptyState title="Nothing waiting for you" body="When a trade needs your OK, it will show up here." />
        ) : null}
        {visible.map((it) => (
          <ApprovalCard key={it.id} item={it} tx={tx[it.id] ?? { kind: 'idle' }} onApprove={() => approve(it)} onReject={() => reject(it)} />
        ))}
        </>
      )}
    </div>
  );
}
