'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BalanceCard } from './BalanceCard';
import { BottomNav } from './BottomNav';
import { ErrorBanner } from './ErrorBanner';
import { Skeleton } from './Skeleton';
import { TradeRow } from './TradeRow';
import type { ActivityItem, AgentStatus, ApprovalItem } from '../lib/types';
import { loadOverview, type OverviewBalances, type Pnl } from '../lib/overview';

function agentLine(agent: AgentStatus | null) {
  if (!agent) return null;
  if (!agent.lastRunAt) return { text: 'Agent not run yet', warn: true };
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

function PnlCard({ pnl }: { pnl: Pnl }) {
  const ngn = Number(pnl.pnlNgn);
  const usd = Number(pnl.pnlUsd);
  const up = ngn >= 0;
  const since = new Date(pnl.pnlSince).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 'var(--radius-card)',
        border: '1px solid var(--border)',
        background: 'var(--surface)',
      }}
    >
      <p className="small" style={{ margin: '0 0 4px', color: 'var(--ink-muted)' }}>
        Saved vs holding naira · since {since}
      </p>
      <p style={{ margin: 0, fontWeight: 700, fontSize: 20, color: up ? 'var(--brand)' : 'var(--danger)' }}>
        {up ? '+' : '−'}₦{Math.abs(ngn).toLocaleString('en-NG', { maximumFractionDigits: 0 })}
        <span className="small" style={{ marginLeft: 8, color: 'var(--ink-muted)', fontWeight: 500 }}>
          ({up ? '+' : '−'}${Math.abs(usd).toLocaleString('en-US', { maximumFractionDigits: 2 })})
        </span>
      </p>
    </div>
  );
}

export function Overview({ vault }: { vault: `0x${string}` }) {
  const [balances, setBalances] = useState<OverviewBalances | null>(null);
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [approvals, setApprovals] = useState<ApprovalItem[] | null>(null);
  const [agent, setAgent] = useState<AgentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const d = await loadOverview(vault);
      setBalances(d.balances);
      setActivity(d.activity);
      setApprovals(d.approvals);
      setAgent(d.agent);
      if (d.apiDown) setError('Agent status is unavailable right now. Balances are read from the chain.');
    } catch {
      setError('Could not load your vault. Try again.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault]);

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
            {balances && !balances.rateKnown ? (
              <p className="small" style={{ margin: 0, color: 'var(--ink-muted)' }}>
                Waiting for the agent&apos;s first rate check to value your vault.
              </p>
            ) : null}
            {balances && balances.balances.every((b) => b.amount === '0') ? (
              <p className="small" style={{ margin: 0, padding: 12, borderRadius: 'var(--radius-btn)', background: 'var(--brand-soft)', color: 'var(--ink)' }}>
                Your vault is empty. Deposit cNGN or USD₮ and the agent will start protecting it.
              </p>
            ) : null}
            {balances?.pnl ? <PnlCard pnl={balances.pnl} /> : null}

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
