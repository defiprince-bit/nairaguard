'use client';

import { useEffect, useState } from 'react';
import { ApprovalCard, type TxState } from './ApprovalCard';
import { EmptyState } from './EmptyState';
import { ErrorBanner } from './ErrorBanner';
import { Skeleton } from './Skeleton';
import { sendApproveSwap } from '../lib/approve';
import { getJson } from '../lib/overview';
import type { ApprovalItem } from '../lib/types';

export const dismissedKey = (vault: string) => `ng:rejected:${vault.toLowerCase()}`;

export function friendly(e: unknown): string {
  const err = e as { code?: number; shortMessage?: string; message?: string; name?: string };
  if (err.code === 4001 || err.name === 'UserRejectedRequestError' || /reject|denied/i.test(err.message ?? '')) {
    return 'You cancelled in your wallet. Nothing was traded.';
  }
  const msg = err.shortMessage ?? err.message ?? '';
  if (/ApprovalExpired/.test(msg)) return 'This approval expired before it went through.';
  if (/DailyLimitExceeded/.test(msg)) return 'This would go over your daily limit, so it was not sent.';
  if (/TradeTooLarge/.test(msg)) return 'This is above your per-trade limit, so it was not sent.';
  return 'The approval failed. Nothing was traded. Try again in a moment.';
}

export function ApprovalsList({ owner, vault, onCount }: { owner: `0x${string}`; vault: `0x${string}`; onCount?: (n: number) => void }) {
  const [items, setItems] = useState<ApprovalItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tx, setTx] = useState<Record<string, TxState>>({});
  const [rejected, setRejected] = useState<string[]>([]);

  useEffect(() => {
    try { setRejected(JSON.parse(localStorage.getItem(dismissedKey(vault)) ?? '[]')); } catch { /* ignore */ }
  }, [vault]);

  async function load() {
    setError(null);
    setItems(null);
    try {
      const r = await getJson<{ items: ApprovalItem[] }>(`vault/${vault.toLowerCase()}/approvals`);
      if (!r.ok) throw new Error(String(r.status));
      setItems([...(r.data?.items ?? [])].sort((a, b) => +new Date(a.expiresAt) - +new Date(b.expiresAt)));
    } catch {
      setError('Could not load approvals. Try again.');
      setItems([]);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault]);

  const visible = (items ?? []).filter((i) => !rejected.includes(i.id));
  const pendingCount = visible.filter((i) => tx[i.id]?.kind !== 'ok').length;
  useEffect(() => { onCount?.(pendingCount); }, [pendingCount, onCount]);

  async function approve(item: ApprovalItem) {
    setTx((t) => ({ ...t, [item.id]: { kind: 'waiting' } }));
    try {
      const hash = await sendApproveSwap(owner, vault, BigInt(item.id));
      setTx((t) => ({ ...t, [item.id]: { kind: 'ok', hash } }));
    } catch (e) {
      setTx((t) => ({ ...t, [item.id]: { kind: 'error', message: friendly(e) } }));
    }
  }

  /** The Vault has no reject function: rejecting = not executing. The proposal simply expires on-chain. */
  function reject(item: ApprovalItem) {
    const next = [...rejected, item.id];
    setRejected(next);
    try { localStorage.setItem(dismissedKey(vault), JSON.stringify(next)); } catch { /* ignore */ }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error ? <ErrorBanner message={error} onRetry={load} /> : null}
      {items === null ? (
        <><Skeleton height={200} /><Skeleton height={200} /></>
      ) : !error && visible.length === 0 ? (
        <EmptyState title="Nothing waiting for you" body="When a trade needs your OK, it will show up here." />
      ) : (
        visible.map((it) => (
          <ApprovalCard key={it.id} item={it} tx={tx[it.id] ?? { kind: 'idle' }} onApprove={() => approve(it)} onReject={() => reject(it)} />
        ))
      )}
      {rejected.length > 0 && visible.length < (items ?? []).length ? (
        <p className="small" style={{ margin: 0, color: 'var(--ink-muted)' }}>
          Rejected trades are not executed and expire on their own. Nothing is sent to the chain.
        </p>
      ) : null}
    </div>
  );
}
