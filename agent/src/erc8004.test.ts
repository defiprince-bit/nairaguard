import { decodeFunctionData, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import { agentCardUri, buildRegisterTx, IDENTITY_REGISTRY_MAINNET, identityRegistryAbi } from './erc8004.js';
import { ATTRIBUTION_SUFFIX, assertTagged, buildDeploy } from './txBuilder.js';

describe('ERC-8004 register', () => {
  it('register() calldata ends with the celo_9efd0f97b491 suffix and decodes', () => {
    const uri = agentCardUri('https://nairaguard-vert.vercel.app');
    expect(uri).toBe('https://nairaguard-vert.vercel.app/.well-known/agent.json');
    const tx = buildRegisterTx(IDENTITY_REGISTRY_MAINNET, uri);
    expect(tx.to).toBe(IDENTITY_REGISTRY_MAINNET);
    expect(tx.data.endsWith(ATTRIBUTION_SUFFIX.slice(2))).toBe(true);
    expect(decodeFunctionData({ abi: identityRegistryAbi, data: tx.data }).args).toEqual([uri]);
  });

  it('refuses untagged calldata', () => {
    expect(() => assertTagged('0x1234' as Hex)).toThrow(/refusing to send/);
  });
});

describe('tagged contract creation', () => {
  it('appends the suffix after constructor args', () => {
    const abi = [{ type: 'constructor', inputs: [{ name: 'a', type: 'address' }], stateMutability: 'nonpayable' }] as const;
    const d = buildDeploy({ abi, bytecode: '0x6080', args: ['0x00000000000000000000000000000000000000aa'] });
    expect(d.data.startsWith('0x6080')).toBe(true);
    expect(d.data.endsWith(ATTRIBUTION_SUFFIX.slice(2))).toBe(true);
    expect(d.data).toContain('00000000000000000000000000000000000000aa');
    assertTagged(d.data);
  });
});
