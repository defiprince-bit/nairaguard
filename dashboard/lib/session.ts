/** Short-lived browser-tab login session (sessionStorage). Cleared on tab close. */

export const SESSION_KEY = 'ng.session';
/** Max age within a tab; sessionStorage already clears when the tab closes. */
export const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export type SessionRecord = {
  address: string;
  chainId: number;
  signedAt: number;
};

export type SignRequest = (args: { method: string; params?: unknown[] }) => Promise<unknown>;

export function buildLoginMessage(address: string, chainId: number, issuedAt: number): string {
  return [
    'NairaGuard login',
    '',
    `Address: ${address}`,
    `Chain ID: ${chainId}`,
    `Issued at: ${issuedAt}`,
  ].join('\n');
}

/** UTF-8 string → 0x-hex for personal_sign. */
export function utf8ToHex(message: string): `0x${string}` {
  const bytes = new TextEncoder().encode(message);
  let hex = '0x';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex as `0x${string}`;
}

export function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

export function parseSession(raw: string | null): SessionRecord | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<SessionRecord>;
    if (typeof o.address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(o.address)) return null;
    if (typeof o.chainId !== 'number' || !Number.isFinite(o.chainId)) return null;
    if (typeof o.signedAt !== 'number' || !Number.isFinite(o.signedAt)) return null;
    return { address: normalizeAddress(o.address), chainId: o.chainId, signedAt: o.signedAt };
  } catch {
    return null;
  }
}

export function isSessionValid(
  session: SessionRecord | null,
  address: string,
  now = Date.now(),
  maxAgeMs = SESSION_MAX_AGE_MS,
): boolean {
  if (!session) return false;
  if (normalizeAddress(session.address) !== normalizeAddress(address)) return false;
  if (now - session.signedAt > maxAgeMs) return false;
  if (session.signedAt > now + 60_000) return false; // clock skew / future
  return true;
}

export function readSession(storage: Pick<Storage, 'getItem'>): SessionRecord | null {
  try {
    return parseSession(storage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

export function writeSession(
  storage: Pick<Storage, 'setItem'>,
  address: string,
  chainId: number,
  signedAt = Date.now(),
): SessionRecord {
  const record: SessionRecord = {
    address: normalizeAddress(address),
    chainId,
    signedAt,
  };
  storage.setItem(SESSION_KEY, JSON.stringify(record));
  return record;
}

export function clearSession(storage: Pick<Storage, 'removeItem'>): void {
  try {
    storage.removeItem(SESSION_KEY);
  } catch {
    /* private mode / unavailable */
  }
}

export function hasValidSession(
  storage: Pick<Storage, 'getItem'>,
  address: string,
  now = Date.now(),
): boolean {
  return isSessionValid(readSession(storage), address, now);
}

/**
 * Ask the wallet for a personal_sign of the login message.
 * On success, persist the session. On reject (code 4001), throw with `{ code: 4001 }`.
 */
export async function requestLoginSignature(
  request: SignRequest,
  storage: Pick<Storage, 'setItem'>,
  address: string,
  chainId: number,
  issuedAt = Date.now(),
): Promise<SessionRecord> {
  const message = buildLoginMessage(address, chainId, issuedAt);
  const hex = utf8ToHex(message);
  try {
    await request({ method: 'personal_sign', params: [hex, address] });
  } catch (e) {
    const code = (e as { code?: number }).code;
    const err = new Error('Login signature rejected') as Error & { code: number };
    err.code = code === 4001 ? 4001 : (typeof code === 'number' ? code : -1);
    throw err;
  }
  return writeSession(storage, address, chainId, issuedAt);
}

/** In-memory Storage stand-in for tests. */
export function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    get length() { return map.size; },
    clear() { map.clear(); },
    getItem(k: string) { return map.has(k) ? map.get(k)! : null; },
    setItem(k: string, v: string) { map.set(k, String(v)); },
    removeItem(k: string) { map.delete(k); },
    key(i: number) { return [...map.keys()][i] ?? null; },
  };
}
