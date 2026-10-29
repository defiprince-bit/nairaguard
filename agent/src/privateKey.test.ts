import { describe, expect, it } from 'vitest';
import { readPrivateKey } from './privateKey.js';

const good = 'ab'.repeat(32);

describe('readPrivateKey', () => {
  it('accepts 0x-prefixed and bare 64-char hex', () => {
    expect(readPrivateKey({ AGENT_PRIVATE_KEY: `0x${good}` })).toBe(`0x${good}`);
    expect(readPrivateKey({ AGENT_PRIVATE_KEY: ` ${good.toUpperCase()} ` })).toBe(`0x${good}`);
  });
  it('rejects missing, wrong length, non-hex and zero keys without echoing them', () => {
    expect(() => readPrivateKey({})).toThrow(/is required/);
    expect(() => readPrivateKey({ AGENT_PRIVATE_KEY: '0x1234' })).toThrow(/64 hex chars.*got 4/);
    const bad = `0x${'zz'.repeat(32)}`;
    expect(() => readPrivateKey({ AGENT_PRIVATE_KEY: bad })).toThrow(/hexadecimal/);
    try { readPrivateKey({ AGENT_PRIVATE_KEY: bad }); } catch (e) { expect(String(e)).not.toContain(bad); }
    expect(() => readPrivateKey({ AGENT_PRIVATE_KEY: `0x${'0'.repeat(64)}` })).toThrow(/zero/);
  });
});
