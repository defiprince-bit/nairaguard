import { describe, expect, it, vi } from 'vitest';
import {
  SESSION_KEY,
  SESSION_MAX_AGE_MS,
  buildLoginMessage,
  clearSession,
  hasValidSession,
  isSessionValid,
  memoryStorage,
  normalizeAddress,
  parseSession,
  readSession,
  requestLoginSignature,
  utf8ToHex,
  writeSession,
} from './session';

const ADDR = '0x6ff7cdc54d057013010bb9e6984bcc9fcd44be22';
const ADDR_CS = '0x6Ff7CdC54d057013010bB9e6984BCc9Fcd44Be22';

describe('buildLoginMessage', () => {
  it('includes address, chain id and issued-at timestamp', () => {
    const msg = buildLoginMessage(ADDR, 11142220, 1_700_000_000_000);
    expect(msg).toContain('NairaGuard login');
    expect(msg).toContain(`Address: ${ADDR}`);
    expect(msg).toContain('Chain ID: 11142220');
    expect(msg).toContain('Issued at: 1700000000000');
  });

  it('utf8ToHex round-trips readable text for personal_sign', () => {
    const msg = buildLoginMessage(ADDR, 11142220, 42);
    const hex = utf8ToHex(msg);
    expect(hex.startsWith('0x')).toBe(true);
    const decoded = new TextDecoder().decode(
      Uint8Array.from(hex.slice(2).match(/.{2}/g)!.map((b) => parseInt(b, 16))),
    );
    expect(decoded).toBe(msg);
  });
});

describe('parseSession / isSessionValid', () => {
  it('rejects null, garbage and incomplete records', () => {
    expect(parseSession(null)).toBeNull();
    expect(parseSession('')).toBeNull();
    expect(parseSession('{')).toBeNull();
    expect(parseSession(JSON.stringify({ address: ADDR }))).toBeNull();
    expect(parseSession(JSON.stringify({ address: 'not-an-address', chainId: 1, signedAt: 1 }))).toBeNull();
  });

  it('normalises address case', () => {
    const s = parseSession(JSON.stringify({ address: ADDR_CS, chainId: 11142220, signedAt: 100 }));
    expect(s?.address).toBe(normalizeAddress(ADDR));
  });

  it('accepts a matching non-expired session', () => {
    const now = 1_000_000;
    const session = { address: normalizeAddress(ADDR), chainId: 11142220, signedAt: now - 60_000 };
    expect(isSessionValid(session, ADDR_CS, now)).toBe(true);
  });

  it('rejects wrong address, expired, or future-dated sessions', () => {
    const now = 1_000_000;
    const base = { address: normalizeAddress(ADDR), chainId: 11142220, signedAt: now };
    expect(isSessionValid(null, ADDR, now)).toBe(false);
    expect(isSessionValid({ ...base, address: '0x1111111111111111111111111111111111111111' }, ADDR, now)).toBe(false);
    expect(isSessionValid({ ...base, signedAt: now - SESSION_MAX_AGE_MS - 1 }, ADDR, now)).toBe(false);
    expect(isSessionValid({ ...base, signedAt: now + 120_000 }, ADDR, now)).toBe(false);
  });
});

describe('storage helpers', () => {
  it('write → read → hasValidSession → clear', () => {
    const store = memoryStorage();
    const now = Date.now();
    writeSession(store, ADDR_CS, 11142220, now);
    expect(store.getItem(SESSION_KEY)).toBeTruthy();
    const got = readSession(store);
    expect(got).toEqual({ address: normalizeAddress(ADDR), chainId: 11142220, signedAt: now });
    expect(hasValidSession(store, ADDR, now)).toBe(true);
    expect(hasValidSession(store, '0x1111111111111111111111111111111111111111', now)).toBe(false);
    clearSession(store);
    expect(readSession(store)).toBeNull();
    expect(hasValidSession(store, ADDR, now)).toBe(false);
  });

  it('treats missing storage reads as no session (reject path)', () => {
    const store = memoryStorage();
    expect(hasValidSession(store, ADDR)).toBe(false);
  });
});

describe('requestLoginSignature accept / reject', () => {
  it('accept: calls personal_sign with hex message and writes the session', async () => {
    const store = memoryStorage();
    const issuedAt = 1_700_000_000_000;
    const expectedHex = utf8ToHex(buildLoginMessage(ADDR, 11142220, issuedAt));
    const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
      expect(method).toBe('personal_sign');
      expect(params).toEqual([expectedHex, ADDR]);
      return '0xsig';
    });
    const record = await requestLoginSignature(request, store, ADDR, 11142220, issuedAt);
    expect(record).toEqual({ address: normalizeAddress(ADDR), chainId: 11142220, signedAt: issuedAt });
    expect(hasValidSession(store, ADDR, issuedAt)).toBe(true);
    expect(request).toHaveBeenCalledOnce();
  });

  it('reject: user cancels (4001) — no session written, error carries code 4001', async () => {
    const store = memoryStorage();
    const request = vi.fn(async () => {
      const e = new Error('User rejected') as Error & { code: number };
      e.code = 4001;
      throw e;
    });
    await expect(requestLoginSignature(request, store, ADDR, 11142220, 42)).rejects.toMatchObject({ code: 4001 });
    expect(store.getItem(SESSION_KEY)).toBeNull();
  });

  it('reject: other wallet errors also leave no session', async () => {
    const store = memoryStorage();
    const request = vi.fn(async () => {
      throw new Error('boom');
    });
    await expect(requestLoginSignature(request, store, ADDR, 11142220, 42)).rejects.toMatchObject({ code: -1 });
    expect(hasValidSession(store, ADDR)).toBe(false);
  });
});
