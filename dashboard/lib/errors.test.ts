import { describe, expect, it, vi } from 'vitest';
import { MSG_BALANCE, MSG_CANCELLED, MSG_FEES, MSG_GENERIC, friendlyError } from './errors';

describe('friendlyError', () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  it('fee currency', () => {
    expect(friendlyError(new Error('insufficient fee-currency balance'))).toEqual({ kind: 'error', message: MSG_FEES });
    expect(friendlyError({ message: 'User not authenticated' }).message).toBe(MSG_FEES);
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
    expect(friendlyError(e)).toEqual({ kind: 'error', message: MSG_GENERIC });
    expect(friendlyError(undefined).message).toBe(MSG_GENERIC);
    expect(spy).toHaveBeenCalledWith(e);
  });
});
