'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BalanceCard } from './BalanceCard';
import { BottomNav } from './BottomNav';
import { ErrorBanner } from './ErrorBanner';
import { Skeleton } from './Skeleton';
import { TradeRow } from './TradeRow';
import type { ActivityItem, AgentStatus, ApprovalItem, BalancesResponse } from '../lib/types';

function agentLine(agent: AgentStatus | null) {
  if (!agent) return null;
  const mins = Math.round((Date.now() - new Date(agent.lastRunAt).getTime()) / 60_000);
  const stale = mins > 15 || !agent.healthy;
  if (stale) {
    return {
      text: `Agent quiet · last check ${mins} min ago`,
      warn: true,
    };
  }
  return {
    text: `Agent active · last check ${Math.max(1, mins)} min ago`,
    warn: false,
  };
}

export function Overview() {
  const [balances, setBalances] = useState<BalancesResponse | null>(null);
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [approvals, setApprovals] = useState<ApprovalItem[] | null>(null);
  const [agent, setAgent] = useState<AgentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [b, a, p, g] = await Promise.all([
        fetch('/api/mock/balances').then((r) => r.json()),
        fetch('/api/mock/activity').then((r) => r.json()),
        fetch('/api/mock/approvals').then((r) => r.json()),
        fetch('/api/mock/agent').then((r) => r.json()),
      ]);
      setBalances(b);
      setActivity(a.items);
      setApprovals(p.items);
      setAgent(g);
    } catch {
      setError('Could not load your vault. Try again.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const status = agentLine(agent);
  const pending = approvals?.length ?? 0;

  return (
    <>
      <main style={{ maxWidth: 480, margin: '0 auto', padding: '8px 16px 24px' }}>
        {error ? <ErrorBanner message={error} onRetry={load} /> : null}

        {loading && !balances ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Skeleton height={160} />
            <Skeleton height={40} />
            <Skeleton height={88} />
            <Skeleton height={88} />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {balances ? <BalanceCard data={balances} /> : null}

            {status ? (
              <p
                className="small"
                style={{
                  margin: 0,
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-btn)',
                  background: status.warn ? 'var(--warn-soft)' : 'var(--brand-soft)',
                  color: status.warn ? 'var(--warn)' : 'var(--brand)',
                  fontWeight: 600,
                }}
              >
                {status.text}
              </p>
            ) : null}

            {pending > 0 ? (
              <Link
                href="/app/approvals"
                style={{
                  display: 'block',
                  textDecoration: 'none',
                  padding: 14,
                  borderRadius: 'var(--radius-card)',
                  background: 'var(--warn-soft)',
                  color: 'var(--warn)',
                  border: '1px solid #f0d7a8',
                  fontWeight: 600,
                }}
              >
                {pending} trade{pending === 1 ? '' : 's'} waiting for your approval →
              </Link>
            ) : null}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <h2 className="h2" style={{ margin: 0 }}>
                Recent activity
              </h2>
              <Link href="/app/activity" className="small" style={{ fontWeight: 600 }}>
                See all
              </Link>
            </div>

            {activity && activity.length === 0 ? (
              <p className="small" style={{ color: 'var(--ink-muted)' }}>
                No trades yet. Once the agent runs, they will show up here with a plain-English reason.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {activity?.slice(0, 3).map((item) => (
                  <TradeRow key={item.id} item={item} />
                ))}
              </div>
            )}
          </div>
        )}
      </main>
      <BottomNav approvalCount={pending} />
    </>
  );
}
