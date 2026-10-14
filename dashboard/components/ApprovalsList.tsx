'use client';

import { useEffect, useState } from 'react';
import { ApprovalCard, type TxState } from './ApprovalCard';
import { EmptyState } from './EmptyState';
import { ErrorBanner } from './ErrorBanner';
import { Skeleton } from './Skeleton';
import { sendApproveSwap, sendRejectSwap } from '../lib/approve';
import { getJson } from '../lib/overview';
import type { ApprovalItem } from '../lib/types';
import { type FriendlyError, MSG_GENERIC, friendlyError } from '../lib/errors';

/** Approval-specific mapping on top of the shared friendlyError (which logs the raw error). */
export function friendlyTx(e: unknown): FriendlyError {
  const base = friendlyError(e);
  if (base.kind === 'cancelled' || base.message !== MSG_GENERIC) return base;
  const err = e as { shortMessage?: string; message?: string };
  const msg = `${err?.shortMessage ?? ''} ${err?.message ?? ''}`;
  if (/ApprovalRejected/.test(msg)) return { kind: 'error', message: 'You already rejected this trade.' };
  if (/ApprovalExpired/.test(msg)) return { kind: 'error', message: 'This approval expired before it went through.' };
  if (/DailyLimitExceeded/.test(msg)) return { kind: 'error', message: 'This would go over your daily limit, so it was not sent.' };
  if (/TradeTooLarge/.test(msg)) return { kind: 'error', message: 'This is above your per-trade limit, so it was not sent.' };
  return base;
}

const toTx = (f: FriendlyError): TxState => (f.kind === 'cancelled' ? { kind: 'cancelled', message: f.message } : { kind: 'error', message: f.message });

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
  const pendingCount = visible.filter((i) => (i.status ?? 'pending') === 'pending' && tx[i.id]?.kind !== 'ok' && tx[i.id]?.kind !== 'rejected').length;
  useEffect(() => { onCount?.(pendingCount); }, [pendingCount, onCount]);

  async function approve(item: ApprovalItem) {
    setTx((t) => ({ ...t, [item.id]: { kind: 'waiting', action: 'approve' } }));
    try {
      const hash = await sendApproveSwap(owner, vault, BigInt(item.id));
      setTx((t) => ({ ...t, [item.id]: { kind: 'ok', hash } }));
    } catch (e) {
      setTx((t) => ({ ...t, [item.id]: toTx(friendlyTx(e)) }));
    }
  }

  async function reject(item: ApprovalItem) {
    setTx((t) => ({ ...t, [item.id]: { kind: 'waiting', action: 'reject' } }));
    try {
      const hash = await sendRejectSwap(owner, vault, BigInt(item.id));
      setTx((t) => ({ ...t, [item.id]: { kind: 'rejected', hash } }));
    } catch (e) {
      setTx((t) => ({ ...t, [item.id]: toTx(friendlyTx(e)) }));
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
