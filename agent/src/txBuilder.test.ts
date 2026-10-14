import { describe, expect, it } from 'vitest';
import { fromDataSuffix, toDataSuffix } from '@celo/attribution-tags';
import { parseAbi } from 'viem';
import { ATTRIBUTION_TAG } from './config.js';
import {
  ATTRIBUTION_SUFFIX,
  buildContractCall,
  buildTransfer,
  isTagged,
  tagCalldata,
} from './txBuilder.js';
import { vaultAbi } from './vaultAbi.js';

describe('txBuilder attribution', () => {
  it('uses the Loops ERC-8021 suffix for ATTRIBUTION_TAG', () => {
    expect(ATTRIBUTION_SUFFIX).toBe(toDataSuffix(ATTRIBUTION_TAG));
    expect(fromDataSuffix(ATTRIBUTION_SUFFIX)?.codes).toContain(ATTRIBUTION_TAG);
  });

  it('tagCalldata appends the tag to empty / contract calldata', () => {
    const empty = tagCalldata();
    expect(isTagged(empty)).toBe(true);
    expect(fromDataSuffix(empty)?.codes).toContain(ATTRIBUTION_TAG);

    const selector =
      '0xa9059cbb00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000001' as const;
    const tagged = tagCalldata(selector);
    expect(tagged.startsWith(selector)).toBe(true);
    expect(tagged.endsWith(ATTRIBUTION_SUFFIX.slice(2))).toBe(true);
    expect(isTagged(tagged)).toBe(true);
  });

  it('tagCalldata is idempotent (no double suffix)', () => {
    const once = tagCalldata('0xdeadbeef');
    const twice = tagCalldata(once);
    expect(twice).toBe(once);
  });

  it('every buildContractCall / buildTransfer carries the tag', () => {
    const abi = parseAbi(['function swap(address,address,uint256,uint256,uint256)']);
    const call = buildContractCall({
      address: '0xA47F3e8b08a94D1933e2031416d54640A0BEF63B',
      abi,
      functionName: 'swap',
      args: [
        '0xfe37fbEA39ce656d7f8181e946E723b7b0D8cecB',
        '0x65F5245b352EfE3ed15EdfE20efc8222107efC3c',
        1n,
        1n,
        1n,
      ],
    });
    expect(isTagged(call.data)).toBe(true);
    expect(fromDataSuffix(call.data)?.codes).toContain(ATTRIBUTION_TAG);

    const transfer = buildTransfer('0xA2A173A481BC063fEE0EF11c67Fc756DC5f928f4', 1n);
    expect(isTagged(transfer.data)).toBe(true);
  });

  it('the agent tx to the vault (swapViaRfq) carries celo_9efd0f97b491, even with reactor calldata inside', () => {
    const vault = '0xD436aA344C0E2a58a607443680651a2c32066be6';
    const reactor = '0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3';
    const tx = buildContractCall({
      address: vault, abi: vaultAbi, functionName: 'swapViaRfq',
      args: ['0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f', '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e', 1n, 1n, reactor, reactor, '0x0dcd7a6c', 0n],
    });
    expect(tx.to).toBe(vault);
    expect(ATTRIBUTION_TAG).toBe('celo_9efd0f97b491');
    expect(fromDataSuffix(tx.data)?.codes).toContain('celo_9efd0f97b491');
  });

  it('does not export a raw send path — only tagged helpers', async () => {
    const mod = await import('./txBuilder.js');
    const forbidden = ['sendTransaction', 'writeContract', 'createWalletClient', 'privateKeyToAccount'];
    for (const name of forbidden) {
      expect(Object.keys(mod)).not.toContain(name);
      expect((mod as Record<string, unknown>)[name]).toBeUndefined();
    }
    expect(typeof mod.createTxSender).toBe('function');
    expect(typeof mod.tagCalldata).toBe('function');
    expect(typeof mod.buildContractCall).toBe('function');
    expect(typeof mod.buildTransfer).toBe('function');
  });
});
