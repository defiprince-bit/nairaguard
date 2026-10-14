'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BottomNav, NAV_ITEMS } from './BottomNav';
import { ErrorBanner } from './ErrorBanner';
import { Skeleton } from './Skeleton';
import { DepositSheet, WithdrawSheet } from './MoneySheet';
import { dismissedKey, friendly } from './ApprovalsList';
import s from './Overview.module.css';
import { sendApproveSwap } from '../lib/approve';
import { approvalRate, formatCountdown, lastCheck, msLeft, tradeOut, txUrl } from '../lib/format';
import { loadOverview, type OverviewBalances } from '../lib/overview';
import { type ApiLimits, initials, pnlPct, presetFor, ringDash, signedMoney, splitAmount, usd18 } from '../lib/overviewView';
import { shorten } from '../lib/wallet';
import { FACTORY_ADDRESS } from '../lib/vault';
import type { ActivityItem, AgentStatus, ApprovalItem } from '../lib/types';

type Cur = 'NGN' | 'USD';
const NETWORK_LABEL = process.env.NEXT_PUBLIC_NETWORK === 'celo' ? 'Celo' : 'Celo Sepolia';

function agentLine(agent: AgentStatus | null, vaultCheckedAt?: string | null) {
  if (!agent && !vaultCheckedAt) return null;
  const last = lastCheck(vaultCheckedAt ?? agent?.lastCheckedAt, agent?.lastRunAt);
  if (!last) return { text: 'Agent not run yet', warn: true };
  const mins = Math.round((Date.now() - new Date(last).getTime()) / 60_000);
  if (mins > 15 || (agent ? !agent.healthy : false)) return { text: `Agent quiet · last check ${mins} min ago`, warn: true };
  return { text: `Agent active · last check ${Math.max(1, mins)} min ago`, warn: false };
}

function timeLabel(iso: string) {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 60 * 12) return d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' });
  if (mins < 60 * 36) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function tradeView(item: ActivityItem) {
  const toUsd = item.out?.token === 'USDT';
  if (item.kind === 'deposit') return { title: 'Deposited', icon: item.in?.token === 'USDT' ? '$' : '₦', up: true, usd: Number(item.in?.amountUsd ?? 0), atLeast: false };
  if (item.kind === 'withdraw') return { title: 'Withdrew', icon: (item.out ?? item.in)?.token === 'USDT' ? '$' : '₦', up: false, usd: -Number((item.out ?? item.in)?.amountUsd ?? 0), atLeast: false };
  const out = tradeOut(item);
  const usd = Number(out?.money.amountUsd ?? item.in?.amountUsd ?? 0);
  return { title: toUsd ? 'Moved to dollars' : 'Topped up naira', icon: toUsd ? '$' : '₦', up: toUsd, usd: toUsd ? usd : -usd, atLeast: !!out?.atLeast };
}

function Eye({ hidden }: { hidden: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
      <circle cx="12" cy="12" r="3" />
      {hidden ? <path d="M3 3l18 18" /> : null}
    </svg>
  );
}

function ApprovalBanner({ item, owner, vault, onDone, onReject }: { item: ApprovalItem; owner: `0x${string}`; vault: `0x${string}`; onDone: () => void; onReject: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const [state, setState] = useState<'idle' | 'waiting' | 'ok' | 'error'>('idle');
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const left = msLeft(item.expiresAt, now);
  const expired = left <= 0;
  const rate = approvalRate(item);
  const to = item.minOut.token === 'USDT' ? 'USD₮' : 'cNGN';
  const what = rate !== null || item.in.token === 'USDT'
    ? `$${Number(item.in.token === 'USDT' ? item.in.amountUsd : Number(item.in.amountNgn) / (rate ?? 1)).toFixed(0)} to ${to}`
    : `Swap to ${to}`;
  async function approve() {
    setState('waiting'); setMsg(null);
    try { await sendApproveSwap(owner, vault, BigInt(item.id)); setState('ok'); setTimeout(onDone, 1500); }
    catch (e) { setState('error'); setMsg(friendly(e)); }
  }
  return (
    <section className={`${s.c} ${s.ap}`} aria-label="Trade waiting for your approval">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className={s.lbl}>Needs your OK · {what}</div>
        <div className={s.cd} aria-live="polite">{expired ? 'Expired' : formatCountdown(left)}</div>
        <div className={s.lbl} style={{ fontSize: 12 }}>
          {state === 'ok' ? 'Approved ✓' : state === 'error' ? msg : rate === null ? 'Rate unavailable · Auto-cancels if you don\u2019t answer' : 'Auto-cancels if you don\u2019t answer'}
        </div>
      </div>
      <div className={s.apBtns}>
      <button type="button" className={s.pill} onClick={onReject} disabled={expired || state === 'waiting' || state === 'ok'}>Reject</button>
      <button type="button" className={`${s.pill} ${s.yes}`} onClick={approve} disabled={expired || state === 'waiting' || state === 'ok'}>
        {state === 'waiting' ? 'Waiting…' : 'Approve'}
      </button>
      </div>
    </section>
  );
}

export function Overview({ vault, owner, miniPay }: { vault: `0x${string}`; owner: `0x${string}`; miniPay?: boolean }) {
  const path = usePathname();
  const [balances, setBalances] = useState<OverviewBalances | null>(null);
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [approvals, setApprovals] = useState<ApprovalItem[] | null>(null);
  const [agent, setAgent] = useState<AgentStatus | null>(null);
  const [limits, setLimits] = useState<ApiLimits | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cur, setCur] = useState<Cur>('NGN');
  const [hidden, setHidden] = useState(false);
  const [sheet, setSheet] = useState<'deposit' | 'withdraw' | null>(null);
  const [rejected, setRejected] = useState<string[]>([]);

  useEffect(() => {
    try { setHidden(localStorage.getItem('ng:hide') === '1'); } catch { /* ignore */ }
    try { setRejected(JSON.parse(localStorage.getItem(dismissedKey(vault)) ?? '[]')); } catch { /* ignore */ }
  }, [vault]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const d = await loadOverview(vault);
      setBalances(d.balances);
      setActivity(d.activity);
      setApprovals(d.approvals);
      setAgent(d.agent);
      setLimits(d.limits);
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

  function toggleHide() {
    setHidden((h) => { try { localStorage.setItem('ng:hide', h ? '0' : '1'); } catch { /* ignore */ } return !h; });
  }
  function reject(id: string) {
    const next = [...rejected, id];
    setRejected(next);
    try { localStorage.setItem(dismissedKey(vault), JSON.stringify(next)); } catch { /* ignore */ }
  }

  const status = agentLine(agent, balances?.lastCheckedAt);
  const live = useMemo(
    () => (approvals ?? []).filter((a) => !rejected.includes(a.id) && msLeft(a.expiresAt) > 0).sort((a, b) => +new Date(a.expiresAt) - +new Date(b.expiresAt)),
    [approvals, rejected],
  );
  const pending = live.length;

  const cngn = balances?.balances.find((b) => b.token === 'cNGN');
  const usdt = balances?.balances.find((b) => b.token === 'USDT');
  const totalNgn = Number(cngn?.amountNgn ?? 0) + Number(usdt?.amountNgn ?? 0);
  const totalUsd = Number(cngn?.amountUsd ?? 0) + Number(usdt?.amountUsd ?? 0);
  const rate = Number(cngn?.rate || usdt?.rate || 0);
  const empty = !!balances && balances.balances.every((b) => b.amount === '0');
  const main = splitAmount(cur === 'NGN' ? totalNgn : totalUsd, cur);
  const usdShare = balances ? 100 - balances.ngnShareBps / 100 : 0;
  const targetUsd = balances ? 100 - balances.targetNgnBps / 100 : 0;
  const pnl = balances?.pnl ?? null;
  const pct = pnl ? pnlPct(Number(pnl.pnlNgn), totalNgn) : null;
  const monthTrades = (activity ?? []).filter((a) => a.kind === 'swap' && new Date(a.at).getMonth() === new Date().getMonth() && new Date(a.at).getFullYear() === new Date().getFullYear()).length;
  const preset = presetFor(limits);
  const factory = FACTORY_ADDRESS as `0x${string}`;
  const mask = '••••••';

  const R = 48, r2 = 34;

  return (
    <div className={s.page}>
      <aside className={s.side} aria-label="Sections">
        <Link href="/app" className={s.brand}><img src="/icon-v2.svg" alt="" />NairaGuard</Link>
        {NAV_ITEMS.map((n) => {
          const on = n.exact ? path === n.href : path.startsWith(n.href);
          return (
            <Link key={n.href} href={n.href} className={on ? s.sideOn : ''} aria-current={on ? 'page' : undefined}>
              {n.label}{n.badgeKey === 'approvals' && pending > 0 ? ` · ${pending}` : ''}
            </Link>
          );
        })}
      </aside>

      <div className={s.main}>
        <header className={s.top}>
          <span className={s.brand}><img src="/icon-v2.svg" alt="" />NairaGuard</span>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span className={`${s.chip} ${s.chipLt}`}>● {NETWORK_LABEL}{miniPay ? ' · MiniPay' : ''}</span>
            <span className={s.av} title={owner} aria-label={`Wallet ${shorten(owner)}`}>{initials(owner)}</span>
          </div>
        </header>

        <main className={s.grid}>
          {error ? <div style={{ gridColumn: '1 / -1' }}><ErrorBanner message={error} onRetry={load} /></div> : null}

          {/* Balance */}
          <section className={`${s.c} ${s.hero}`} aria-label="Vault balance">
            <div className={s.row}>
              <span className={s.lbl}>Vault balance</span>
              <div className={s.tog} role="group" aria-label="Currency">
                <button type="button" className={cur === 'NGN' ? s.on : ''} aria-pressed={cur === 'NGN'} onClick={() => setCur('NGN')}>₦ NGN</button>
                <button type="button" className={cur === 'USD' ? s.on : ''} aria-pressed={cur === 'USD'} onClick={() => setCur('USD')}>$ USD</button>
              </div>
            </div>
            {loading && !balances ? (
              <div style={{ margin: '14px 0 8px' }}><Skeleton height={48} width="80%" radius={12} /><div style={{ height: 8 }} /><Skeleton height={14} width="50%" /></div>
            ) : (
              <>
                <div className={s.big}>
                  {hidden ? mask : <>{main.whole}<small>{main.dec}</small></>}
                  <button type="button" className={s.eye} onClick={toggleHide} aria-label={hidden ? 'Show balance' : 'Hide balance'} aria-pressed={hidden}>
                    <Eye hidden={hidden} />
                  </button>
                </div>
                <div className={s.sub}>
                  {balances && rate > 0 && !hidden
                    ? `≈ ${cur === 'NGN' ? splitAmount(totalUsd, 'USD').whole + splitAmount(totalUsd, 'USD').dec : splitAmount(totalNgn, 'NGN').whole} · `
                    : balances && rate === 0 ? 'Waiting for the agent\u2019s first rate check · ' : ''}
                  {shorten(vault)}
                </div>
                {empty ? <p className={s.empty}>Your vault is empty. Deposit cNGN or USD₮ and the agent will start protecting it.</p> : null}
              </>
            )}
            <div className={s.btns}>
              <button type="button" className={`${s.pill} ${s.dk}`} onClick={() => setSheet('deposit')} disabled={!factory}>＋ Deposit</button>
              <button type="button" className={s.pill} onClick={() => setSheet('withdraw')} disabled={!factory || empty}>Withdraw</button>
              <Link href="/app/activity" className={s.rnd} aria-label="See all activity">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M7 17L17 7M9 7h8v8" /></svg>
              </Link>
            </div>
          </section>

          {/* Saved vs holding naira — only real P&L */}
          {pnl ? (
            <section className={`${s.c} ${s.hl}`} aria-label="Saved vs holding naira">
              <div className={s.row}>
                <span className={s.lbl}>Saved vs holding naira</span>
                <span className={s.chip}>
                  {Number(pnl.pnlNgn) >= 0 ? '↗' : '↘'} {pct !== null ? `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}% ` : ''}since {new Date(pnl.pnlSince).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </span>
              </div>
              <div className={s.mid}>{hidden ? mask : signedMoney(cur === 'NGN' ? Number(pnl.pnlNgn) : Number(pnl.pnlUsd), cur)}</div>
              <div className={s.sub}>What your vault is worth beyond plain cNGN</div>
              <div className={s.minis}>
                <div className={s.mini}>Trades this month<b>{activity ? monthTrades : '—'}</b></div>
                <div className={s.mini}>Naira rate today<b>{rate > 0 ? `₦${rate.toLocaleString('en-US', { maximumFractionDigits: 0 })} / $` : 'Unavailable'}</b></div>
              </div>
            </section>
          ) : loading && !balances ? (
            <section className={`${s.c} ${s.hl}`} aria-hidden><Skeleton height={20} width="50%" /><div style={{ height: 12 }} /><Skeleton height={40} width="60%" /></section>
          ) : null}

          {/* Approval banner (first pending, soonest expiry) */}
          {live[0] ? (
            <ApprovalBanner key={live[0].id} item={live[0]} owner={owner} vault={vault} onDone={load} onReject={() => reject(live[0]!.id)} />
          ) : null}

          {/* Mix ring */}
          <section className={`${s.c} ${s.mix}`} aria-label="Your mix">
            <div className={s.row}>
              <span className={s.h3}>Your mix</span>
              {balances ? <span className={`${s.chip} ${s.chipLt}`}>Target {targetUsd.toFixed(0)}% USD₮</span> : null}
            </div>
            {loading && !balances ? (
              <div className={s.ring}><Skeleton height={120} width={120} radius={60} /><div style={{ flex: 1 }}><Skeleton height={14} /><div style={{ height: 8 }} /><Skeleton height={14} width="70%" /></div></div>
            ) : balances && !empty && rate > 0 ? (
              <div className={s.ring}>
                <svg width="120" height="120" viewBox="0 0 120 120" role="img" aria-label={`${usdShare.toFixed(0)}% in USD₮ now, target ${targetUsd.toFixed(0)}%`}>
                  <defs><linearGradient id="ngRing"><stop stopColor="#0E7A4F" /><stop offset="1" stopColor="#1FA36A" /></linearGradient></defs>
                  <circle cx="60" cy="60" r={R} fill="none" stroke="var(--border)" strokeWidth="14" />
                  <circle cx="60" cy="60" r={R} fill="none" stroke="url(#ngRing)" strokeWidth="14" strokeLinecap="round" strokeDasharray={ringDash(usdShare, R)} transform="rotate(-90 60 60)" />
                  <circle cx="60" cy="60" r={r2} fill="none" stroke="var(--mint)" strokeWidth="4" strokeDasharray={ringDash(targetUsd, r2)} transform="rotate(-90 60 60)" />
                  <text x="60" y="58" textAnchor="middle" fontWeight="800" fontSize="22" fill="var(--ink-strong)">{usdShare.toFixed(0)}%</text>
                  <text x="60" y="75" textAnchor="middle" fontSize="10" fill="var(--ink-muted)">USD₮ now</text>
                </svg>
                <div className={s.leg}>
                  <div><i style={{ background: '#1FA36A' }} />USD₮ {usdShare.toFixed(0)}%</div>
                  <div><i style={{ background: 'var(--border)' }} />cNGN {(100 - usdShare).toFixed(0)}%</div>
                  <div><i style={{ background: 'var(--mint)' }} />Target {targetUsd.toFixed(0)} / {(100 - targetUsd).toFixed(0)}</div>
                </div>
              </div>
            ) : (
              <p className={s.empty}>{empty ? 'Your mix will show here after your first deposit.' : 'Your mix will show after the agent\u2019s first rate check.'}</p>
            )}
          </section>

          {/* Agent */}
          <section className={`${s.c} ${s.ag}`} aria-label="Agent">
            <div className={s.row}>
              <span className={s.h3}>Agent</span>
              {preset ? <span className={`${s.chip} ${s.chipLt}`}>{preset}</span> : null}
            </div>
            {status ? (
              <div className={s.st} role="status"><span className={`${s.dot} ${status.warn ? s.dotWarn : ''}`} aria-hidden />{status.text}</div>
            ) : loading ? <div style={{ marginTop: 12 }}><Skeleton height={18} width="80%" /></div> : (
              <div className={s.st}><span className={`${s.dot} ${s.dotWarn}`} aria-hidden />Agent status unavailable</div>
            )}
            <div className={s.sub} style={{ marginTop: 8 }}>Watching the naira rate and keeping you near your target.</div>
            {limits ? (
              <div className={s.kv}>
                <div>Max per trade<b>${usd18(limits.maxTradeUsd).toLocaleString('en-US')}</b></div>
                <div>Asks above<b>${usd18(limits.approvalThresholdUsd).toLocaleString('en-US')}</b></div>
                <div>Daily limit<b>${usd18(limits.maxDailyUsd).toLocaleString('en-US')}</b></div>
                <div>Slippage<b>{(limits.maxSlippageBps / 100).toLocaleString('en-US')}%</b></div>
              </div>
            ) : loading ? <div className={s.kv}><Skeleton height={52} radius={16} /><Skeleton height={52} radius={16} /></div> : null}
          </section>

          {/* Recent trades */}
          <section className={`${s.c} ${s.trs}`} aria-label="Recent trades">
            <div className={s.row} style={{ marginBottom: 6 }}>
              <span className={s.h3}>Recent trades</span>
              <Link href="/app/activity" className={s.see}>See all →</Link>
            </div>
            {activity === null && loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}><Skeleton height={44} /><Skeleton height={44} /><Skeleton height={44} /></div>
            ) : (activity ?? []).length === 0 ? (
              <p className={s.empty}>No trades yet. Once the agent runs, they will show up here with a plain-English reason.</p>
            ) : (
              (activity ?? []).slice(0, 3).map((it) => {
                const v = tradeView(it);
                return (
                  <a key={it.id} className={s.tr} href={txUrl(it.txHash)} target="_blank" rel="noreferrer">
                    <div className={`${s.ic} ${v.up ? s.icUp : s.icDn}`} aria-hidden>{v.icon}</div>
                    <div className={s.t}><b>{v.title}</b><span>{it.reason}</span></div>
                    <div className={`${s.amt} ${v.up ? s.g : s.r}`}>
                      {hidden ? '••' : `${v.atLeast ? '≥ ' : ''}${signedMoney(v.usd, 'USD')}`}
                      <span>{it.status === 'confirmed' ? timeLabel(it.at) : it.status === 'pending' ? 'Pending' : 'Failed'}</span>
                    </div>
                  </a>
                );
              })
            )}
          </section>
        </main>
      </div>

      <BottomNav approvalCount={pending} hideWide />
      {sheet === 'deposit' && factory ? (
        <DepositSheet owner={owner} factory={factory} vault={vault} onClose={() => setSheet(null)} onDone={() => { setSheet(null); load(); }} />
      ) : null}
      {sheet === 'withdraw' && factory ? (
        <WithdrawSheet owner={owner} factory={factory} vault={vault} onClose={() => setSheet(null)} onDone={() => { setSheet(null); load(); }} />
      ) : null}
    </div>
  );
}
