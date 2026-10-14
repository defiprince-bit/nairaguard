import { describe, expect, it } from 'vitest';
import { approvalView, floorRate, officialRateLine, pausedLine, perTradeError, quoteOutcomeLine, venueLine } from './format';
import type { ApprovalItem, Money } from './types';

const m = (token: Money['token'], amount: string, ngn: string, usd: string): Money => ({ token, amount, amountNgn: ngn, amountUsd: usd, rate: '1360', rateAt: null });
const base: ApprovalItem = {
  id: '1', reason: 'r', expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  in: m('cNGN', '136000', '136000', '100'), minOut: m('USDT', '100000000', '136000', '100'),
};

describe('8b helpers', () => {
  it('floorRate from ₦ and $ legs, scaled by approvedMinOut', () => {
    expect(floorRate(base)).toBe(1360);
    expect(floorRate({ ...base, approvedMinOut: '50000000' })).toBe(2720);
    expect(floorRate({ ...base, in: m('USDT', '100', '136000', '100'), minOut: m('cNGN', '1', '135000', '99') })).toBe(1350);
  });
  it('approval states', () => {
    expect(approvalView(base).line).toBe('Swap ~$100 to USD₮ · at ₦1,360/$ or better');
    expect(approvalView({ ...base, status: 'approved', approvedAt: 'x' }).line).toMatch(/^Approved · trading within \d+m \d\ds at ₦1,360\/\$ or better$/);
    expect(approvalView({ ...base, status: 'executed', rateNgnPerUsd: '1361' }).line).toBe('Traded at ₦1,361/$');
    const ex = approvalView({ ...base, status: 'approved', approvedAt: 'x', expiresAt: new Date(Date.now() - 1).toISOString() });
    expect(ex).toEqual({ state: 'expired', tone: 'muted', line: "Didn't trade, price never reached your limit" });
  });
  it('venue and outcomes', () => {
    expect(venueLine('textile', 'celo')).toBe('via Textile FX');
    expect(venueLine('celo-pool', 'celo')).toBe('via Celo pool');
    expect(venueLine('Ubeswap', 'celo')).toBe('via Ubeswap');
    expect(venueLine(null, 'celo')).toBeNull();
    expect(venueLine('textile-mock', 'sepolia')).toBe('Test swap (mock exchange)');
    expect(quoteOutcomeLine('price_moved')).toBe("Price moved, didn't trade");
    expect(quoteOutcomeLine('no_quote')).toMatch(/^No offer/);
    expect(quoteOutcomeLine('filled')).toBeNull();
  });
  it('official rate, paused, min trade', () => {
    expect(officialRateLine('1330.00', new Date(Date.now() - 3 * 60_000).toISOString())).toBe('Official rate ₦1,330/$ · updated 3 min ago');
    expect(officialRateLine(null)).toBeNull();
    expect(pausedLine('stale_price')).toBe('Paused, waiting for a fresh naira price.');
    expect(pausedLine(null)).toBeNull();
    expect(perTradeError('0.5')).toBe('Smallest trade is about $1.');
    expect(perTradeError('5')).toBeNull();
  });
});
