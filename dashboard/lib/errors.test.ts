import { describe, expect, it, vi } from 'vitest';
import { MSG_BALANCE, MSG_CANCELLED, MSG_FEES, MSG_FEES_STABLE, MSG_GENERIC, classifyError, friendlyError } from './errors';
import { WrongChainError } from './sendTagged';

describe('friendlyError', () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  it('fee currency', () => {
    expect(friendlyError(new Error('insufficient fee-currency balance'))).toEqual({ kind: 'error', message: MSG_FEES_STABLE });
    expect(friendlyError({ message: 'User not authenticated' }).message).toBe(MSG_FEES_STABLE);
    expect(friendlyError(new Error('insufficient funds for gas * price + value')).message).toBe(MSG_FEES);
  });
  it('balance', () => {
    expect(friendlyError(new Error('execution reverted: 0xf4d678b8')).message).toBe(MSG_BALANCE);
    expect(friendlyError({ shortMessage: 'reverted', data: { data: '0xf4d678b8' } }).message).toBe(MSG_BALANCE);
    expect(friendlyError(new Error('ERC20: transfer amount exceeds balance')).message).toBe(MSG_BALANCE);
    expect(friendlyError({ message: 'x', cause: { name: 'InsufficientBalance' , message: 'InsufficientBalance()' } }).message).toBe(MSG_BALANCE);
  });
  it('cancelled', () => {
    expect(friendlyError({ code: 4001, message: 'x' })).toEqual({ kind: 'cancelled', message: MSG_CANCELLED });
    expect(friendlyError({ name: 'UserRejectedRequestError' }).kind).toBe('cancelled');
    expect(friendlyError(new Error('User rejected the request.')).kind).toBe('cancelled');
    expect(friendlyError(new Error('Request denied')).kind).toBe('cancelled');
    expect(friendlyError({ message: 'outer', cause: { code: 4001 } }).kind).toBe('cancelled');
  });
  it('generic + logs raw', () => {
    spy.mockClear();
    const e = new Error('weird');
    expect(friendlyError(e)).toEqual({ kind: 'error', message: `${MSG_GENERIC} (weird)`, generic: true });
    expect(friendlyError(undefined)).toEqual({ kind: 'error', message: MSG_GENERIC, generic: true });
    expect(spy).toHaveBeenCalledWith(e);
  });
});

describe('createVault reverts', () => {
  it('maps VaultExists (0x4239717c)', async () => {
    const { classifyError, MSG_VAULT_EXISTS } = await import('./errors');
    expect(classifyError({ message: 'execution reverted', data: '0x4239717c' }).message).toBe(MSG_VAULT_EXISTS);
    expect(MSG_VAULT_EXISTS).toBe('You already have a vault. Taking you to deposit…');
  });
  it('VaultExists and timeout are neutral create outcomes', async () => {
    const { classifyCreateError, MSG_TIMEOUT } = await import('./errors');
    expect(classifyCreateError({ data: '0x4239717c' }).kind).toBe('exists');
    expect(classifyCreateError(new Error('Timed out waiting for confirmation'))).toEqual({
      kind: 'pending', message: "Still confirming on the network. This can take a minute, so we'll keep checking.",
    });
    expect(MSG_TIMEOUT).toContain('keep checking');
    expect(classifyCreateError({ code: 4001 }).kind).toBe('cancelled');
  });
});

describe('wrong chain, native gas, generic reason', () => {
  it('WrongChainError shows its own message', () => {
    const e = new WrongChainError(1, 11142220);
    expect(classifyError(e)).toEqual({ kind: 'error', message: 'Switch to Celo Sepolia in your wallet, then try again.' });
    expect(classifyError({ message: 'wrapped', cause: e }).message).toMatch(/^Switch to Celo Sepolia/);
  });
  it('native gas phrasings map to the CELO fee message', () => {
    expect(MSG_FEES).toBe('Add a little CELO to pay network fees.');
    for (const e of [
      { name: 'InsufficientFundsError', message: 'x' },
      new Error('The total cost (gas * gas fee + value) of executing this transaction exceeds the balance of the account.'),
      { code: -32000, message: 'insufficient funds for transfer' },
      { code: -32003, message: 'Insufficient balance' },
      { message: 'outer', cause: { code: -32000, message: 'gas too low' } },
      new Error('Insufficient balance for gas fee'), // OKX
      new Error('Insufficient balance to pay network fee'), // OKX
      new Error('Not enough CELO to cover the network fee'),
      new Error('insufficient funds for gas * price + value'),
    ]) expect(classifyError(e).message).toBe(MSG_FEES);
  });
  it('token shortfalls still map to balance, not fees', () => {
    expect(classifyError({ code: -32000, message: 'execution reverted: ERC20: transfer amount exceeds balance' }).message).toBe(MSG_BALANCE);
    expect(classifyError(new Error('exceeds balance')).message).toBe(MSG_BALANCE);
  });
  it('MiniPay fee-currency errors keep the stablecoin message', () => {
    expect(classifyError({ message: 'outer', cause: { message: 'insufficient feeCurrency balance' } }).message).toBe(MSG_FEES_STABLE);
  });
  it('unknown errors append a trimmed shortMessage', () => {
    const r = classifyError({ shortMessage: 'HTTP request failed.', message: 'HTTP request failed.\n\nURL: https://x\nDetails: boom' });
    expect(r).toEqual({ kind: 'error', message: `${MSG_GENERIC} (HTTP request failed.)`, generic: true });
    const long = classifyError(new Error('a'.repeat(300))).message;
    expect(long.length).toBeLessThanOrEqual(MSG_GENERIC.length + 3 + 120);
    expect(long.endsWith('…)')).toBe(true);
  });
});
