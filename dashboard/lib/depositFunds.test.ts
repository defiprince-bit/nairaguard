import { describe, expect, it } from 'vitest';
import { MINIPAY_ADD_CASH_USDT, walletNeedsTopUp } from './depositFunds';

describe('walletNeedsTopUp', () => {
  it('is true only when both cNGN and USD₮ are zero', () => {
    expect(walletNeedsTopUp(0n, 0n)).toBe(true);
    expect(walletNeedsTopUp(1n, 0n)).toBe(false);
    expect(walletNeedsTopUp(0n, 1n)).toBe(false);
    expect(walletNeedsTopUp(5n, 5n)).toBe(false);
  });

  it('points MiniPay top-up at the USD₮ add-cash deeplink', () => {
    expect(MINIPAY_ADD_CASH_USDT).toBe('https://link.minipay.xyz/add_cash?tokens=USDT');
  });
});
