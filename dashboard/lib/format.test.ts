import { decodeFunctionData } from 'viem';
import { describe, expect, it } from 'vitest';
import { buildApproveSwap, vaultApprovalAbi } from './approve';
import { approvalRate, countdownA11y, formatCountdown, groupByDay, lastCheck, matchesFilter, msLeft, tradeOut } from './format';
import type { ActivityItem, ApprovalItem, Money } from './types';
import { ATTRIBUTION_SUFFIX } from './vault';

const m = (token: Money['token'], amount: string, ngn: string, usd: string, rate = '1585'): Money =>
  ({ token, amount, amountNgn: ngn, amountUsd: usd, rate, rateAt: '2026-10-14T10:00:00Z' });
const swap = (over: Partial<ActivityItem> = {}): ActivityItem => ({
  id: '1', kind: 'swap', reason: 'r', txHash: '0x1', status: 'confirmed', at: '2026-10-14T10:00:00Z',
  in: m('cNGN', '1', '1585', '1'), out: m('USDT', '1000000', '1585', '1.00'), ...over,
});

describe('countdown', () => {
  it('formats minutes/seconds and hours', () => {
    expect(formatCountdown(65_000)).toBe('1m 05s');
    expect(formatCountdown(3_840_000)).toBe('1h 04m');
    expect(formatCountdown(999)).toBe('0m 00s');
    expect(formatCountdown(0)).toBe('Expired');
    expect(formatCountdown(-5)).toBe('Expired');
    expect(formatCountdown(NaN)).toBe('Expired');
  });
  it('a11y text is minute-granular', () => {
    expect(countdownA11y(61_000)).toBe('Expires in 2 minutes');
    expect(countdownA11y(60_000)).toBe('Expires in 1 minute');
    expect(countdownA11y(0)).toBe('This approval has expired');
  });
  it('msLeft', () => {
    expect(msLeft('2026-10-14T10:01:00Z', Date.parse('2026-10-14T10:00:00Z'))).toBe(60_000);
  });
});

describe('trade output', () => {
  it('falls back to min-out labelled at least', () => {
    expect(tradeOut(swap())).toEqual({ money: swap().out, atLeast: true });
  });
  it('uses amountOut Money when present', () => {
    const a = m('USDT', '1100000', '1743', '1.10');
    expect(tradeOut(swap({ amountOut: a }))).toEqual({ money: a, atLeast: false });
  });
  it('scales values for raw amountOut', () => {
    const r = tradeOut(swap({ amountOut: '2000000' }))!;
    expect(r.atLeast).toBe(false);
    expect(Number(r.money.amountUsd)).toBeCloseTo(2);
  });
  it('deposits are never "at least"', () => {
    expect(tradeOut(swap({ kind: 'deposit' }))!.atLeast).toBe(false);
    expect(tradeOut(swap({ out: undefined }))).toBeNull();
  });
});

describe('approval rate', () => {
  const a = (over: Partial<ApprovalItem> = {}): ApprovalItem => ({
    id: '1', reason: '', expiresAt: '', in: m('cNGN', '1', '1', '1', '1'), minOut: m('USDT', '1', '1', '1'), ...over,
  });
  it('null → unavailable', () => expect(approvalRate(a({ rateNgnPerUsd: null }))).toBeNull());
  it('field wins', () => expect(approvalRate(a({ rateNgnPerUsd: '1600' }))).toBe(1600));
  it('old API placeholder rate 1 → unavailable', () => expect(approvalRate(a())).toBeNull());
});

describe('lists', () => {
  it('filters', () => {
    expect(matchesFilter(swap(), 'executed')).toBe(true);
    expect(matchesFilter(swap({ status: 'failed' }), 'pending')).toBe(false);
    expect(matchesFilter(swap({ status: 'failed' }), 'all')).toBe(true);
  });
  it('groups by day newest first', () => {
    const now = new Date('2026-10-14T15:00:00');
    const g = groupByDay([
      swap({ id: 'a', at: new Date('2026-10-12T09:00:00').toISOString() }),
      swap({ id: 'b', at: new Date('2026-10-14T09:00:00').toISOString() }),
      swap({ id: 'c', at: new Date('2026-10-13T09:00:00').toISOString() }),
    ], now);
    expect(g.map((x) => x.label)).toEqual(['Today', 'Yesterday', '12 Oct']);
  });
  it('lastCheck prefers per-vault', () => {
    expect(lastCheck('a', 'b')).toBe('a');
    expect(lastCheck(null, 'b')).toBe('b');
    expect(lastCheck(undefined, null)).toBeNull();
  });
});

describe('approve tx', () => {
  it('encodes Vault.approve(id) with the attribution tag', () => {
    const tx = buildApproveSwap('0x2222222222222222222222222222222222222222', 7n);
    expect(tx.data.toLowerCase().endsWith(ATTRIBUTION_SUFFIX.slice(2).toLowerCase())).toBe(true);
    const d = decodeFunctionData({ abi: vaultApprovalAbi, data: tx.data.slice(0, 2 + 8 + 64) as `0x${string}` });
    expect(d.functionName).toBe('approve');
    expect(d.args[0]).toBe(7n);
  });
});

import { buildRejectSwap, vaultRejectAbi, REJECT_HELPER } from './approve';
import { rejectedLabel, noRate, tokenUnits } from './format';
import { activityPath } from '../components/ActivityList';

describe('reject + rate-unavailable', () => {
  it('encodes Vault.reject(id) with the attribution tag', () => {
    const tx = buildRejectSwap('0x2222222222222222222222222222222222222222', 9n);
    expect(tx.data.toLowerCase().endsWith(ATTRIBUTION_SUFFIX.slice(2).toLowerCase())).toBe(true);
    const d = decodeFunctionData({ abi: vaultRejectAbi, data: tx.data.slice(0, 2 + 8 + 64) as `0x${string}` });
    expect(d.functionName).toBe('reject');
    expect(d.args[0]).toBe(9n);
  });
  it('helper copy', () => expect(REJECT_HELPER).toBe('Got it. The agent won\u2019t suggest this again for about 6 hours unless the naira moves a lot.'));
  it('rejected label', () => {
    expect(rejectedLabel(null)).toBe('You rejected this');
    expect(rejectedLabel('2026-10-14T17:02:00Z')).toMatch(/^You rejected this · 14 Oct, \d\d:02$/);
  });
  it('null money → rate unavailable; token units', () => {
    expect(noRate({ amountNgn: null, amountUsd: null })).toBe(true);
    expect(noRate({ amountNgn: '1', amountUsd: '1' })).toBe(false);
    expect(noRate(undefined)).toBe(true);
    expect(tokenUnits({ token: 'cNGN', amount: '120000000000000000000000' })).toBe('120,000 cNGN');
  });
  it('activity paging path', () => {
    expect(activityPath('0xAB', null)).toBe('vault/0xab/activity?limit=20');
    expect(activityPath('0xab', 'a+b/=')).toBe('vault/0xab/activity?limit=20&cursor=a%2Bb%2F%3D');
  });
});
