import { fromDataSuffix } from '@celo/attribution-tags';
import { type Hex, encodeFunctionData, parseAbi } from 'viem';
import { describe, expect, it } from 'vitest';
import { buildApproveSwap, buildRejectSwap } from './approve';
import { WrongChainError, sendTagged } from './sendTagged';
import { CHAIN } from './overview';
import { ATTRIBUTION_SUFFIX, ATTRIBUTION_TAG, buildApprove, buildCreateVault, buildDeposit, presetLimits, type Tx } from './vault';
import { buildWithdraw } from './withdraw';

const F = '0x1111111111111111111111111111111111111111' as const;
const V = '0x2222222222222222222222222222222222222222' as const;
const T = '0x3333333333333333333333333333333333333333' as const;
const OWNER = '0x4444444444444444444444444444444444444444' as const;

/** Fake EIP-1193 providers standing in for MiniPay, an injected wallet and WalletConnect. */
function fakeProvider(name: string, chainId: number = CHAIN.id) {
  const sent: { from: string; to: string; data: Hex }[] = [];
  return {
    name, sent,
    request: async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (method === 'eth_chainId') return `0x${chainId.toString(16)}`;
      if (method !== 'eth_sendTransaction') throw new Error(`unexpected ${method}`);
      sent.push(params![0] as { from: string; to: string; data: Hex });
      return '0xabc';
    },
  };
}

const writes: [string, Tx][] = [
  ['createVault', buildCreateVault(F, presetLimits('balanced', 50))],
  ['approve (ERC-20)', buildApprove(T, V, 10n)],
  ['deposit', buildDeposit(V, T, 10n)],
  ['withdraw', buildWithdraw(V, T, 10n, OWNER)],
  ['approve swap', buildApproveSwap(V, 1n)],
  ['reject swap', buildRejectSwap(V, 1n)],
];

const tagged = (d: Hex) => d.toLowerCase().endsWith(ATTRIBUTION_SUFFIX.slice(2).toLowerCase()) && fromDataSuffix(d)?.codes.includes(ATTRIBUTION_TAG);
const count = (d: Hex) => d.toLowerCase().split(ATTRIBUTION_SUFFIX.slice(2).toLowerCase()).length - 1;

describe('shared write path keeps the attribution tag on every connector', () => {
  for (const connector of ['minipay', 'injected', 'walletconnect']) {
    for (const [name, tx] of writes) {
      it(`${connector}: ${name} goes out tagged exactly once`, async () => {
        const p = fakeProvider(connector);
        await sendTagged(p, OWNER, tx);
        expect(p.sent).toHaveLength(1);
        expect(tagged(p.sent[0].data)).toBe(true);
        expect(count(p.sent[0].data)).toBe(1);
        expect(p.sent[0].to).toBe(tx.to);
      });
    }
    it(`${connector}: untagged calldata is tagged before it leaves`, async () => {
      const p = fakeProvider(connector);
      const raw = encodeFunctionData({ abi: parseAbi(['function deposit(address,uint256)']), functionName: 'deposit', args: [T, 1n] });
      await sendTagged(p, OWNER, { to: V, data: raw });
      expect(tagged(p.sent[0].data)).toBe(true);
    });
  }

  for (const connector of ['minipay', 'injected', 'walletconnect']) {
    for (const [name, tx] of writes) {
      it(`${connector}: ${name} on the wrong chain is blocked before sending`, async () => {
        const p = fakeProvider(connector, CHAIN.id === 42220 ? 1 : 42220);
        await expect(sendTagged(p, OWNER, tx)).rejects.toBeInstanceOf(WrongChainError);
        expect(p.sent).toHaveLength(0);
      });
    }
  }
});
