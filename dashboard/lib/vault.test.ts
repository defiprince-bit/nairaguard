import { fromDataSuffix } from '@celo/attribution-tags';
import { decodeFunctionData, encodeAbiParameters, type Hex, parseUnits } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTION_SUFFIX, ATTRIBUTION_TAG, buildApprove, buildCreateVault, buildDeposit, decodeVaultOf,
  factoryAbi, presetLimits, vaultAbi,
} from './vault';

const FACTORY = '0x1111111111111111111111111111111111111111' as const;
const VAULT = '0x2222222222222222222222222222222222222222' as const;
const CNGN = '0xaA3B7364E418deC4Fb147f1BD2d95A4022082aEA' as const;

const endsWithTag = (data: Hex) => {
  expect(data.toLowerCase().endsWith(ATTRIBUTION_SUFFIX.slice(2).toLowerCase())).toBe(true);
  expect(fromDataSuffix(data)?.codes).toContain(ATTRIBUTION_TAG);
};

describe('attribution tag on user transactions', () => {
  it('suffix encodes celo_9efd0f97b491', () => {
    expect(ATTRIBUTION_TAG).toBe('celo_9efd0f97b491');
  });

  it('createVault calldata ends with the tag and still decodes', () => {
    const limits = presetLimits('balanced', 60);
    const tx = buildCreateVault(FACTORY, limits);
    expect(tx.to).toBe(FACTORY);
    endsWithTag(tx.data);
    const d = decodeFunctionData({ abi: factoryAbi, data: tx.data });
    expect(d.functionName).toBe('createVault');
    expect((d.args![0] as { targetNgnBps: number }).targetNgnBps).toBe(6000);
  });

  it('deposit calldata ends with the tag and still decodes', () => {
    const tx = buildDeposit(VAULT, CNGN, parseUnits('5000', 18));
    expect(tx.to).toBe(VAULT);
    endsWithTag(tx.data);
    const d = decodeFunctionData({ abi: vaultAbi, data: tx.data });
    expect(d.args).toEqual([CNGN, parseUnits('5000', 18)]);
  });

  it('approve calldata is tagged too', () => {
    endsWithTag(buildApprove(CNGN, VAULT, 1n).data);
  });
});

describe('vaultOf lookup', () => {
  it('zero address means no vault yet (onboarding)', () => {
    expect(decodeVaultOf(encodeAbiParameters([{ type: 'address' }], ['0x0000000000000000000000000000000000000000']))).toBeNull();
    expect(decodeVaultOf(encodeAbiParameters([{ type: 'address' }], [VAULT]))?.toLowerCase()).toBe(VAULT);
  });

  it('rejects an out-of-range target', () => {
    expect(() => presetLimits('careful', 101)).toThrow();
  });
});
