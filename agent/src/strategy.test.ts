import { describe, expect, it } from 'vitest';
import { decide, formatNgn, formatUsd, type Limits } from './strategy.js';

const limits: Limits = {
  maxTradeUsd: 500,
  maxDailyUsd: 1_000,
  approvalThresholdUsd: 300,
  maxSlippageBps: 100,
  targetNgnBps: 5_000,
};
const rate = 1_500;

describe('strategy.decide', () => {
  it('computes drift (NGN share) from balances and rate', () => {
    // ₦300,000 = $200 ; + $800 → 20% naira
    const d = decide({ ngnBalance: 300_000, usdBalance: 800, rateNgnPerUsd: rate, limits, dailySpentUsd: 0 });
    expect(d.ngnShareBps).toBe(2_000);
  });

  it('does nothing inside the band', () => {
    // 53% naira vs 50% target, band 5%
    const d = decide({ ngnBalance: 795_000, usdBalance: 470, rateNgnPerUsd: rate, limits, dailySpentUsd: 0 });
    expect(d.action).toBe('none');
    expect(d.reason).toMatch(/within the 5% band/);
  });

  it('sells naira when over target, swap below threshold, minOut from slippage', () => {
    // $1,000 total, 60% naira → ideal $100
    const d = decide({ ngnBalance: 900_000, usdBalance: 400, rateNgnPerUsd: rate, limits, dailySpentUsd: 0 });
    expect(d.action).toBe('swap');
    if (d.action === 'none') throw new Error();
    expect(d.direction).toBe('ngnToUsd');
    expect(d.usdValue).toBeCloseTo(100);
    expect(d.amountIn).toBeCloseTo(150_000);
    expect(d.minOut).toBeCloseTo(99);
  });

  it('buys naira when under target', () => {
    const d = decide({ ngnBalance: 300_000, usdBalance: 800, rateNgnPerUsd: rate, limits, dailySpentUsd: 0 });
    if (d.action === 'none') throw new Error('expected trade');
    expect(d.direction).toBe('usdToNgn');
    expect(d.expectedOut).toBeCloseTo(d.usdValue * rate);
  });

  it('caps size at maxTradeUsd', () => {
    // $10,000 total all naira → ideal $5,000, cap $500 → propose (>= 300)
    const d = decide({ ngnBalance: 15_000_000, usdBalance: 0, rateNgnPerUsd: rate, limits, dailySpentUsd: 0 });
    if (d.action === 'none') throw new Error();
    expect(d.usdValue).toBe(500);
    expect(d.reason).toMatch(/Capped by your limits/);
  });

  it('caps size at remaining daily allowance and stops when used up', () => {
    const d = decide({ ngnBalance: 15_000_000, usdBalance: 0, rateNgnPerUsd: rate, limits, dailySpentUsd: 900 });
    if (d.action === 'none') throw new Error();
    expect(d.usdValue).toBe(100);
    expect(d.action).toBe('swap');

    const done = decide({ ngnBalance: 15_000_000, usdBalance: 0, rateNgnPerUsd: rate, limits, dailySpentUsd: 1_000 });
    expect(done.action).toBe('none');
    expect(done.reason).toMatch(/daily limit/);
  });

  it('routes at/above approval threshold to propose', () => {
    const d = decide({
      ngnBalance: 15_000_000,
      usdBalance: 0,
      rateNgnPerUsd: rate,
      limits: { ...limits, maxTradeUsd: 300 },
      dailySpentUsd: 0,
    });
    expect(d.action).toBe('propose');
    expect(d.reason).toMatch(/needs your OK/);
  });

  it('writes a plain-English reason with ₦ first and $ formatting', () => {
    const d = decide({ ngnBalance: 900_000, usdBalance: 400, rateNgnPerUsd: rate, limits, dailySpentUsd: 0 });
    expect(d.reason).toBe('Naira share is 60%, target 50%. Moved ₦150,000 ($100.00) to USD₮ at ₦1,500/$.');
  });

  it('formats money', () => {
    expect(formatNgn(1_520_400.4)).toBe('₦1,520,400');
    expect(formatUsd(512.3)).toBe('$512.30');
  });

  it('handles an empty vault', () => {
    expect(decide({ ngnBalance: 0, usdBalance: 0, rateNgnPerUsd: rate, limits, dailySpentUsd: 0 }).action).toBe('none');
  });
});

describe('no-trade codes', () => {
  const limits = { maxTradeUsd: 100, maxDailyUsd: 500, approvalThresholdUsd: 100, maxSlippageBps: 100, targetNgnBps: 5000 };
  it('in band, below minimum, daily limit, per-trade limit, empty', () => {
    expect(decide({ ngnBalance: 150_000, usdBalance: 100, rateNgnPerUsd: 1500, limits, dailySpentUsd: 0 })).toMatchObject({ action: 'none', code: 'in_band' });
    const small = decide({ ngnBalance: 0, usdBalance: 1, rateNgnPerUsd: 1500, limits, dailySpentUsd: 0 });
    expect(small).toMatchObject({ action: 'none', code: 'below_min' });
    expect(small.reason).toMatch(/\$0\.50, under the \$1\.00 minimum/);
    expect(decide({ ngnBalance: 0, usdBalance: 100, rateNgnPerUsd: 1500, limits, dailySpentUsd: 500 })).toMatchObject({ code: 'daily_limit' });
    expect(decide({ ngnBalance: 0, usdBalance: 100, rateNgnPerUsd: 1500, limits: { ...limits, maxTradeUsd: 0.5 }, dailySpentUsd: 0 })).toMatchObject({ code: 'trade_limit' });
    expect(decide({ ngnBalance: 0, usdBalance: 0, rateNgnPerUsd: 1500, limits, dailySpentUsd: 0 })).toMatchObject({ code: 'empty' });
  });
});

