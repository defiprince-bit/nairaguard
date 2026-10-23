import { describe, expect, it } from 'vitest';
import { mergeBalances, ngnPerUsdFromAnswer } from './overview';

describe('Naira rate fallback', () => {
  it('converts the Chainlink USD-per-NGN answer to ₦ per $1', () => {
    expect(ngnPerUsdFromAnswer(75075n)).toBeCloseTo(1332.0, 0);
    expect(ngnPerUsdFromAnswer(0n)).toBeNull();
  });
  it('values USD₮ in ₦ with the fallback rate when the agent has no quote yet', () => {
    const chain = { cngn: { raw: '0', decimals: 18 }, usdt: { raw: '1000000', decimals: 6 } };
    const b = mergeBalances(chain, null, 4000, 1332);
    expect(b.rateKnown).toBe(true);
    expect(Number(b.balances[1]!.amountNgn)).toBeCloseTo(1332);
    expect(mergeBalances(chain, null, 4000, null).rateKnown).toBe(false);
  });
});
