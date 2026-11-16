import { describe, expect, it } from 'vitest';
import { decodeFunctionData } from 'viem';
import { buildWithdraw, parseRecipient, shortAddr, vaultWithdrawAbi } from './withdraw';

const OWNER = '0x6Cac3a6Ab6981419f175713B80846c57528311f6' as const;
const DESK = '0x4991c2616e4124e127215EDd73d46f6EFb12CD09' as const;

describe('parseRecipient', () => {
  it('defaults to the connected wallet when blank', () => {
    expect(parseRecipient('', OWNER)).toBe(OWNER);
    expect(parseRecipient('   ', OWNER)).toBe(OWNER);
  });
  it('accepts checksummed and lowercase addresses, returns checksummed', () => {
    expect(parseRecipient(DESK, OWNER)).toBe(DESK);
    expect(parseRecipient(` ${DESK.toLowerCase()} `, OWNER)).toBe(DESK);
  });
  it('rejects a bad checksum, wrong length, junk and the zero address', () => {
    expect(() => parseRecipient('0x4991C2616e4124e127215EDd73d46f6EFb12CD09', OWNER)).toThrow(/valid 0x/);
    expect(() => parseRecipient('0x4991c2616e', OWNER)).toThrow(/valid 0x/);
    expect(() => parseRecipient('hello', OWNER)).toThrow(/valid 0x/);
    expect(() => parseRecipient('0x0000000000000000000000000000000000000000', OWNER)).toThrow(/valid 0x/);
  });
});

describe('withdraw recipient', () => {
  it('shortAddr matches the confirmation format', () => {
    expect(`Sending to ${shortAddr(DESK)}`).toBe('Sending to 0x4991…CD09');
  });
  it('passes the recipient as the `to` argument', () => {
    const tx = buildWithdraw('0xDDa2f62A2b82f70D63eeEEDef2e63eb8FaC22296', '0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f', 1640853930n, DESK);
    const d = decodeFunctionData({ abi: vaultWithdrawAbi, data: tx.data.slice(0, 2 + 8 + 64 * 3) as `0x${string}` });
    expect(d.args?.[1]).toBe(1640853930n);
    expect(d.args?.[2]).toBe(DESK);
  });
});
