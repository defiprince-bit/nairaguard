export type FriendlyError = { kind: 'error' | 'cancelled'; message: string };

export const MSG_FEES = 'Add a little USDC to pay network fees.';
export const MSG_BALANCE = "You don't have enough of this token.";
export const MSG_CANCELLED = 'You cancelled this in your wallet.';
export const MSG_VAULT_EXISTS = 'You already have a vault. Reopen the app to see it.';
export const MSG_TIMEOUT = 'Still confirming. Wait a minute, then reopen the app.';
export const MSG_GENERIC = 'Something went wrong. Please try again.';

type ErrLike = { code?: unknown; name?: unknown; message?: unknown; shortMessage?: unknown; details?: unknown; data?: unknown; cause?: unknown };

/** Collect codes, names and text from an error and its cause chain (viem nests them). */
function flatten(e: unknown): { codes: unknown[]; names: string[]; text: string } {
  const codes: unknown[] = [];
  const names: string[] = [];
  const parts: string[] = [];
  let cur: unknown = e;
  for (let i = 0; i < 8 && cur != null; i++) {
    if (typeof cur === 'string') { parts.push(cur); break; }
    if (typeof cur !== 'object') break;
    const x = cur as ErrLike;
    codes.push(x.code);
    if (typeof x.name === 'string') names.push(x.name);
    for (const v of [x.message, x.shortMessage, x.details]) if (typeof v === 'string') parts.push(v);
    if (typeof x.data === 'string') parts.push(x.data);
    else if (x.data && typeof x.data === 'object') {
      const d = x.data as { data?: unknown; message?: unknown };
      if (typeof d.data === 'string') parts.push(d.data);
      if (typeof d.message === 'string') parts.push(d.message);
    }
    cur = x.cause;
  }
  return { codes, names, text: parts.join(' \n ') };
}

/** Classify an error without logging. */
export function classifyError(e: unknown): FriendlyError {
  const { codes, names, text } = flatten(e);
  if (codes.some((c) => c === 4001 || c === '4001' || c === 'ACTION_REJECTED')
    || names.includes('UserRejectedRequestError')
    || /user rejected|rejected the request|request rejected|denied|user cancel/i.test(text)) {
    return { kind: 'cancelled', message: MSG_CANCELLED };
  }
  if (/0x4239717c|VaultExists/i.test(text)) return { kind: 'error', message: MSG_VAULT_EXISTS };
  if (/timed out waiting for confirmation/i.test(text)) return { kind: 'error', message: MSG_TIMEOUT };
  if (/0xf4d678b8|InsufficientBalance|exceeds balance|transfer amount exceeds/i.test(text)) {
    return { kind: 'error', message: MSG_BALANCE };
  }
  if (/fee-?currency|user not authenticated|insufficient funds|gas required exceeds|funds for gas|for gas \* price|intrinsic gas/i.test(text)) {
    return { kind: 'error', message: MSG_FEES };
  }
  return { kind: 'error', message: MSG_GENERIC };
}

/** Map a raw wallet/RPC error to a friendly message. Always logs the raw error. */
export function friendlyError(e: unknown): FriendlyError {
  console.error(e);
  return classifyError(e);
}
