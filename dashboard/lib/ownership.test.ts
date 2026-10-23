import { fromDataSuffix } from '@celo/attribution-tags';
import { toFunctionSelector, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import { MAINNET_FACTORY, buildAcceptOwnership, sendAcceptOwnership } from './ownership';
import { ATTRIBUTION_SUFFIX, ATTRIBUTION_TAG } from './vault';

describe('acceptOwnership', () => {
  it('calldata is the selector plus the attribution suffix', () => {
    const tx = buildAcceptOwnership();
    expect(tx.to).toBe(MAINNET_FACTORY);
    expect(toFunctionSelector('acceptOwnership()')).toBe('0x79ba5097');
    expect(tx.data.toLowerCase()).toBe(('0x79ba5097' + ATTRIBUTION_SUFFIX.slice(2)).toLowerCase());
    expect(fromDataSuffix(tx.data)?.codes ?? fromDataSuffix(tx.data)).toBeTruthy();
    expect(JSON.stringify(fromDataSuffix(tx.data))).toContain(ATTRIBUTION_TAG);
  });
  it('refuses to send off Celo mainnet', async () => {
    const eth = { request: async ({ method }: { method: string }) => (method === 'eth_chainId' ? '0xaa044c' : (() => { throw new Error(method); })()) };
    await expect(sendAcceptOwnership(eth, '0x6Cac3a6Ab6981419f175713B80846c57528311f6')).rejects.toThrow(/Celo/);
  });
  it('sends tagged calldata to the factory on 42220', async () => {
    const sent: { to: string; data: Hex }[] = [];
    const eth = { request: async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (method === 'eth_chainId') return '0xa4ec';
      if (method === 'eth_sendTransaction') { sent.push(params![0] as never); return '0xabc'; }
      throw new Error(method);
    } };
    await sendAcceptOwnership(eth, '0x6Cac3a6Ab6981419f175713B80846c57528311f6');
    expect(sent[0].to.toLowerCase()).toBe(MAINNET_FACTORY);
    expect(sent[0].data.toLowerCase()).toBe(('0x79ba5097' + ATTRIBUTION_SUFFIX.slice(2)).toLowerCase());
  });
});
