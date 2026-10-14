import { describe, expect, it } from 'vitest';
import { mergeBalances, pickPnl } from './overview';

const chain = { cngn: { raw: '158500000000000000000000', decimals: 18 }, usdt: { raw: '100000000', decimals: 6 } };
const api = {
  balances: [
    { token: 'cNGN' as const, amount: '0', amountNgn: '0', amountUsd: '0', rate: '1585', rateAt: '2026-10-14T00:00:00Z' },
  ],
  ngnShareBps: 0, targetNgnBps: 6000, pnlNgn: '1200.50', pnlUsd: '0.76', pnlSince: '2026-10-10T00:00:00Z',
};

describe('overview data', () => {
  it('values on-chain amounts at the API rate', () => {
    const b = mergeBalances(chain, api, null);
    expect(b.balances[0]!.amountNgn).toBe('158500.00');
    expect(b.balances[1]!.amountNgn).toBe('158500.00');
    expect(b.ngnShareBps).toBe(5000);
    expect(b.targetNgnBps).toBe(6000);
    expect(b.rateKnown).toBe(true);
  });
  it('limits target overrides API target', () => {
    expect(mergeBalances(chain, api, 4000).targetNgnBps).toBe(4000);
  });
  it('still shows chain amounts with no API rate', () => {
    const b = mergeBalances(chain, null, 5000);
    expect(b.rateKnown).toBe(false);
    expect(b.balances[1]!.amountUsd).toBe('100.00');
    expect(b.pnl).toBeNull();
  });
  it('shows P&L only when the API returns it with pnlSince', () => {
    expect(pickPnl(api)).toEqual({ pnlNgn: '1200.50', pnlUsd: '0.76', pnlSince: '2026-10-10T00:00:00Z' });
    expect(pickPnl({ ...api, pnlSince: null })).toBeNull();
    expect(pickPnl({ ...api, pnlNgn: null })).toBeNull();
    expect(pickPnl(null)).toBeNull();
  });
});
