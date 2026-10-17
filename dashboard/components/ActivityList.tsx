'use client';

import { useEffect, useMemo, useState } from 'react';
import { EmptyState } from './EmptyState';
import { ErrorBanner } from './ErrorBanner';
import { Skeleton } from './Skeleton';
import { TradeRow } from './TradeRow';
import { CheckRow } from './CheckRow';
import { Button } from './Button';
import { type Filter, groupByDay, isCheck, matchesFilter } from '../lib/format';
import { getJson } from '../lib/overview';
import type { ActivityItem } from '../lib/types';

const PAGE = 20;

type Page = { items: ActivityItem[]; nextCursor?: string | null };
export const activityPath = (vault: string, cursor?: string | null) =>
  `vault/${vault.toLowerCase()}/activity?limit=${PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'executed', label: 'Executed' },
  { id: 'pending', label: 'Pending' },
  { id: 'failed', label: 'Failed' },
];

export function ActivityList({ vault }: { vault: `0x${string}` }) {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [cursor, setCursor] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [moreErr, setMoreErr] = useState<string | null>(null);

  async function load() {
    setError(null);
    setItems(null);
    try {
      const r = await getJson<Page>(activityPath(vault));
      if (!r.ok) throw new Error(String(r.status));
      setItems(r.data?.items ?? []);
      setCursor(r.data?.nextCursor ?? null);
    } catch {
      setError('Could not load your activity. Try again.');
      setItems([]);
    }
  }
  async function loadMore() {
    if (!cursor) return;
    setMore(true);
    setMoreErr(null);
    try {
      const r = await getJson<Page>(activityPath(vault, cursor));
      if (!r.ok) throw new Error(String(r.status));
      setItems((prev) => {
        const seen = new Set((prev ?? []).map((i) => i.id));
        return [...(prev ?? []), ...(r.data?.items ?? []).filter((i) => !seen.has(i.id))];
      });
      setCursor(r.data?.nextCursor ?? null);
    } catch {
      setMoreErr('Could not load more. Try again.');
    } finally {
      setMore(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault]);

  const filtered = useMemo(() => (items ?? []).filter((i) => matchesFilter(i, filter)), [items, filter]);
  const groups = useMemo(() => groupByDay(filtered), [filtered]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div role="tablist" aria-label="Filter activity" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => setFilter(f.id)}
            style={{
              minHeight: 44,
              padding: '0 14px',
              borderRadius: 999,
              border: '1px solid var(--border)',
              background: filter === f.id ? 'var(--brand)' : 'var(--surface)',
              color: filter === f.id ? 'var(--on-brand)' : 'var(--ink)',
              fontWeight: 600,
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error ? <ErrorBanner message={error} onRetry={load} /> : null}

      {items === null ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Skeleton height={96} /><Skeleton height={96} /><Skeleton height={96} />
        </div>
      ) : !error && filtered.length === 0 ? (
        <EmptyState
          title={filter === 'all' ? 'No activity yet' : 'Nothing here'}
          body={filter === 'all' ? 'Deposits and trades will show up here, each with a plain-English reason.' : 'No trades match this filter.'}
        />
      ) : (
        <>
          {groups.map((g) => (
            <section key={g.label} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h2 className="small" style={{ margin: 0, color: 'var(--ink-muted)', fontWeight: 600 }}>{g.label}</h2>
              {g.items.map((it) => isCheck(it)
                ? <CheckRow key={it.id} item={it} />
                : <TradeRow key={it.id} item={it} />)}
            </section>
          ))}
          {moreErr ? <ErrorBanner message={moreErr} onRetry={loadMore} /> : null}
          {cursor ? (
            <Button variant="secondary" fullWidth onClick={loadMore} disabled={more}>
              {more ? 'Loading…' : 'Load more'}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
