import { describe, expect, it, vi } from 'vitest';
import { recheckCreate, runCreate } from './createVault';

const V = '0x4C71000000000000000000000000000000006c67' as const;
const H = '0xabc' as const;

describe('runCreate', () => {
  it('does not send when a vault already exists', async () => {
    const send = vi.fn();
    const r = await runCreate({ lookup: async () => V, send, wait: vi.fn() });
    expect(r).toEqual({ kind: 'created', vault: V });
    expect(send).not.toHaveBeenCalled();
  });
  it('VaultExists revert is a neutral note carrying the vault', async () => {
    const lookup = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(V);
    const r = await runCreate({ lookup, send: async () => { throw { data: '0x4239717c' }; }, wait: vi.fn() });
    expect(r).toEqual({ kind: 'exists', vault: V, message: 'You already have a vault. Taking you to deposit…' });
  });
  it('receipt timeout is pending and keeps the hash', async () => {
    const r = await runCreate({
      lookup: async () => null, send: async () => H,
      wait: async () => { throw new Error('Timed out waiting for confirmation'); },
    });
    expect(r.kind).toBe('pending');
    expect(r.kind === 'pending' && r.hash).toBe(H);
  });
});

describe('recheckCreate', () => {
  it('finds the vault via vaultOf', async () => {
    expect(await recheckCreate({ lookup: async () => V, wait: vi.fn() }, H)).toEqual({ kind: 'created', vault: V });
  });
  it('re-polls the receipt then vaultOf', async () => {
    const lookup = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(V);
    const wait = vi.fn().mockResolvedValue({ status: '0x1' });
    expect(await recheckCreate({ lookup, wait }, H)).toEqual({ kind: 'created', vault: V });
    expect(wait).toHaveBeenCalledWith(H);
  });
  it('stays pending if still unmined', async () => {
    const r = await recheckCreate({ lookup: async () => null, wait: async () => { throw new Error('Timed out waiting for confirmation'); } }, H);
    expect(r.kind).toBe('pending');
  });
});
