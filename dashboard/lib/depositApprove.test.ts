import { describe, expect, it } from 'vitest';
import { decodeFunctionData, parseUnits } from 'viem';
import { buildDepositTxs, erc20Abi, vaultAbi } from './vault';

const TOKEN = '0x6b941732c3B78D9232cd8332b8D3448B4a13beC0' as const; // Sepolia mock USD₮ (6 decimals)
const VAULT = '0x4C71ed3f68b90AEa0B7C820D126C2E15F2B26c67' as const;
const FACTORY = '0x7C0aDDFc500De0a2Ce06eBa399c3E55E47E2Aceb';
const MAX = 2n ** 256n - 1n;
// tag() appends the ERC-8021 suffix; decodeFunctionData ignores trailing bytes after the args.
const dec = (abi: typeof erc20Abi | typeof vaultAbi, data: `0x${string}`) => decodeFunctionData({ abi, data });

describe('deposit approve', () => {
  it('approves exactly the typed amount to the user\'s own vault, then deposits it', () => {
    const units = parseUnits('2', 6);
    const [approve, deposit] = buildDepositTxs(TOKEN, VAULT, units, 0n);
    expect(approve!.to).toBe(TOKEN);
    const a = dec(erc20Abi, approve!.data);
    expect(a.functionName).toBe('approve');
    expect(a.args).toEqual([VAULT, units]);
    expect(String(a.args![0]).toLowerCase()).not.toBe(FACTORY.toLowerCase());
    expect(a.args![1]).not.toBe(MAX);
    expect(deposit!.to).toBe(VAULT);
    expect(dec(vaultAbi, deposit!.data)).toMatchObject({ functionName: 'deposit', args: [TOKEN, units] });
  });

  it('skips approve when the current allowance already covers the deposit', () => {
    const units = parseUnits('1.5', 6);
    const txs = buildDepositTxs(TOKEN, VAULT, units, units);
    expect(txs).toHaveLength(1);
    expect(dec(vaultAbi, txs[0]!.data).functionName).toBe('deposit');
    expect(buildDepositTxs(TOKEN, VAULT, units, units - 1n)).toHaveLength(2);
  });

  it('rejects zero', () => {
    expect(() => buildDepositTxs(TOKEN, VAULT, 0n, 0n)).toThrow();
  });
});
