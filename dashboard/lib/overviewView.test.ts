import { describe, expect, it } from 'vitest';
import { initials, isTestnet, pnlPct, presetFor, ringDash, signedMoney, splitAmount } from './overviewView';
import { PRESETS } from './vault';

describe('overview view helpers', () => {
  it('splits amounts with grey decimals', () => {
    expect(splitAmount(1284650.4, 'NGN')).toEqual({ whole: '₦1,284,650', dec: '.40' });
    expect(splitAmount(841.2, 'USD')).toEqual({ whole: '$841', dec: '.20' });
    expect(splitAmount(NaN, 'NGN')).toEqual({ whole: '₦0', dec: '.00' });
  });
  it('signed money', () => {
    expect(signedMoney(50620, 'NGN')).toBe('+₦50,620');
    expect(signedMoney(-12, 'USD')).toBe('−$12.00');
  });
  it('matches presets', () => {
    const b = PRESETS.balanced.limits;
    const l = { maxTradeUsd: b.maxTradeUsd.toString(), maxDailyUsd: b.maxDailyUsd.toString(), approvalThresholdUsd: b.approvalThresholdUsd.toString(), maxSlippageBps: b.maxSlippageBps, targetNgnBps: 5000 };
    expect(presetFor(l)).toBe('Balanced');
    expect(presetFor({ ...l, maxSlippageBps: 7 })).toBe('Custom');
    expect(presetFor(null)).toBeNull();
  });
  it('pnl percent', () => {
    expect(pnlPct(50, 1050)).toBeCloseTo(5);
    expect(pnlPct(10, 10)).toBeNull();
  });
  it('ring dash', () => {
    expect(ringDash(50, 10)).toBe('31.4 62.8');
    expect(ringDash(150, 10)).toBe('62.8 62.8');
  });
  it('initials', () => expect(initials('0xab12')).toBe('AB'));
  it('mainnet only for chain 42220', () => {
    expect(isTestnet(42220)).toBe(false);
    expect(isTestnet(42220, 'celo-sepolia')).toBe(false); // chain ID wins over the env
    expect(isTestnet(11142220)).toBe(true); // Celo Sepolia
    expect(isTestnet(11142220, 'celo')).toBe(true); // chain ID wins over the env
    expect(isTestnet(1, 'celo')).toBe(true); // any other chain is testnet
    expect(isTestnet(NaN, 'celo-sepolia')).toBe(true);
  });
  it('falls back to the env only when no chain ID is known, defaulting to testnet', () => {
    expect(isTestnet(undefined, 'celo')).toBe(false);
    expect(isTestnet(null, 'celo')).toBe(false);
    expect(isTestnet(NaN, 'celo')).toBe(false);
    expect(isTestnet(undefined, 'celo-sepolia')).toBe(true);
    expect(isTestnet(undefined, undefined)).toBe(true);
    expect(isTestnet(null, '')).toBe(true);
    expect(isTestnet(undefined, 'Celo')).toBe(true); // exactly `celo` only
  });
});

import { apiChainMismatch, isWrongChain } from './overviewView';
describe('chain guards', () => {
  it('apiChainMismatch flags only a different numeric chainId', () => {
    expect(apiChainMismatch({ chainId: 42220 }, 11142220)).toBe(true);
    expect(apiChainMismatch({ chainId: 42220 }, 42220)).toBe(false);
    expect(apiChainMismatch({}, 42220)).toBe(false);
    expect(apiChainMismatch(null, 42220)).toBe(false);
  });
  it('isWrongChain covers MiniPay testnet mode too', () => {
    expect(isWrongChain('0xabc', 11142220, 42220)).toBe(true);
    expect(isWrongChain('0xabc', 42220, 42220)).toBe(false);
    expect(isWrongChain(null, 11142220, 42220)).toBe(false);
    expect(isWrongChain('0xabc', null, 42220)).toBe(false);
  });
});

import { overviewTestnet, vaultChainIdFrom } from './overviewView';
describe('overviewTestnet (vault chainId overrides wallet)', () => {
  it('vault chain wins over the wallet chain', () => {
    expect(overviewTestnet(42220, 11142220, 'celo-sepolia')).toBe(false);
    expect(overviewTestnet(11142220, 42220, 'celo')).toBe(true);
    expect(overviewTestnet(1, 42220, 'celo')).toBe(true);
  });
  it('falls back to the wallet, then env', () => {
    expect(overviewTestnet(null, 42220, 'celo-sepolia')).toBe(false);
    expect(overviewTestnet(undefined, 11142220, 'celo')).toBe(true);
    expect(overviewTestnet(null, null, 'celo')).toBe(false);
    expect(overviewTestnet(null, null, undefined)).toBe(true);
  });
  it('reads chainId from balances, then status', () => {
    expect(vaultChainIdFrom({ chainId: 42220 }, { chainId: 11142220 })).toBe(42220);
    expect(vaultChainIdFrom(null, { chainId: 11142220 })).toBe(11142220);
    expect(vaultChainIdFrom({}, { chainId: '42220' })).toBeNull();
    expect(vaultChainIdFrom(null, undefined)).toBeNull();
  });
});
