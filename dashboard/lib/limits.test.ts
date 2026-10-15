import { describe, expect, it } from 'vitest';
import { decodeFunctionData } from 'viem';
import { buildSetLimits, formFromApi, formFromPreset, matchPreset, pctToBps, toLimits, unitsToUsd, usdToUnits, validateLimits, vaultLimitsAbi, type LimitsForm } from './limits';
import { ATTRIBUTION_SUFFIX, PRESETS } from './vault';

const base: LimitsForm = { maxTrade: '50', maxDaily: '150', askAbove: '25', slippageBps: 100, targetPct: 50 };

describe('value conversion', () => {
  it('USD → 1e18 units (same unit as PRESETS and Vault.sol limits)', () => {
    expect(usdToUnits('20')).toBe(20n * 10n ** 18n);
    expect(usdToUnits('20.5')).toBe(205n * 10n ** 17n);
    expect(usdToUnits('1,000')).toBe(1000n * 10n ** 18n);
    expect(usdToUnits('20')).toBe(PRESETS.careful.limits.maxTradeUsd);
    expect(usdToUnits('')).toBeNull();
    expect(usdToUnits('-5')).toBeNull();
    expect(usdToUnits('abc')).toBeNull();
    expect(unitsToUsd((25n * 10n ** 18n).toString())).toBe('25');
  });
  it('% → bps', () => {
    expect(pctToBps(0)).toBe(0);
    expect(pctToBps(55)).toBe(5500);
    expect(pctToBps(100)).toBe(10000);
    expect(() => pctToBps(101)).toThrow();
  });
  it('round-trips the API response and builds the tuple', () => {
    const e = (n: number) => (BigInt(n) * 10n ** 18n).toString();
    const f = formFromApi({ maxTradeUsd: e(20), maxDailyUsd: e(50), approvalThresholdUsd: e(5), maxSlippageBps: 50, targetNgnBps: 6500 });
    expect(f).toEqual({ maxTrade: '20', maxDaily: '50', askAbove: '5', slippageBps: 50, targetPct: 65 });
    expect(matchPreset(f)).toBe('careful');
    const l = toLimits(f);
    expect(l).toEqual({ ...PRESETS.careful.limits, targetNgnBps: 6500 });
    const tx = buildSetLimits('0x2222222222222222222222222222222222222222', l);
    expect(tx.data.toLowerCase().endsWith(ATTRIBUTION_SUFFIX.slice(2).toLowerCase())).toBe(true);
    const d = decodeFunctionData({ abi: vaultLimitsAbi, data: tx.data });
    expect(d.functionName).toBe('setLimits');
    expect(d.args[0]).toEqual(l);
  });
  it('presets fill the fields; edits become custom', () => {
    expect(matchPreset(formFromPreset('active', 40))).toBe('active');
    expect(matchPreset({ ...formFromPreset('active', 40), maxTrade: '199' })).toBe('custom');
  });
});

describe('validation', () => {
  it('accepts valid limits', () => expect(validateLimits(base)).toEqual({}));
  it('amounts must be > 0', () => {
    const e = validateLimits({ ...base, maxTrade: '0', maxDaily: '', askAbove: '0' });
    expect(e.maxTrade).toMatch(/more than \$0/);
    expect(e.maxDaily).toMatch(/Enter an amount/);
    expect(e.askAbove).toMatch(/more than \$0/);
  });
  it('ask-me-above ≤ max per trade ≤ daily max', () => {
    expect(validateLimits({ ...base, askAbove: '60' }).askAbove).toMatch(/max per trade/);
    expect(validateLimits({ ...base, maxTrade: '200' }).maxTrade).toMatch(/daily max/);
    expect(validateLimits({ ...base, askAbove: '50', maxTrade: '50', maxDaily: '50' })).toEqual({});
  });
});
