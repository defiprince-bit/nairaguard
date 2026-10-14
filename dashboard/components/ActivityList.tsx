'use client';

import { useEffect, useMemo, useState } from 'react';
import { EmptyState } from './EmptyState';
import { ErrorBanner } from './ErrorBanner';
import { Skeleton } from './Skeleton';
import { TradeRow } from './TradeRow';
import { Button } from './Button';
import { type Filter, groupByDay, matchesFilter } from '../lib/format';
import { getJson } from '../lib/overview';
import type { ActivityItem } from '../lib/types';

const PAGE = 20;
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
  const [shown, setShown] = useState(PAGE);

  async function load() {
    setError(null);
    setItems(null);
    try {
      const r = await getJson<{ items: ActivityItem[] }>(`vault/${vault.toLowerCase()}/activity`);
      if (!r.ok) throw new Error(String(r.status));
      setItems(r.data?.items ?? []);
    } catch {
      setError('Could not load your activity. Try again.');
      setItems([]);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault]);

  const filtered = useMemo(() => (items ?? []).filter((i) => matchesFilter(i, filter)), [items, filter]);
  const groups = useMemo(() => groupByDay(filtered.slice(0, shown)), [filtered, shown]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div role="tablist" aria-label="Filter activity" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => { setFilter(f.id); setShown(PAGE); }}
            style={{
              minHeight: 44,
              padding: '0 14px',
              borderRadius: 999,
              border: '1px solid var(--border)',
              background: filter === f.id ? 'var(--brand)' : 'var(--surface)',
              color: filter === f.id ? '#fff' : 'var(--ink)',
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
              {g.items.map((it) => <TradeRow key={it.id} item={it} />)}
            </section>
          ))}
          {filtered.length > shown ? (
            <Button variant="secondary" fullWidth onClick={() => setShown((n) => n + PAGE)}>
              Load more
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
