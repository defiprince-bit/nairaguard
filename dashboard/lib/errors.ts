/** `generic` is set when nothing more specific matched (the message then carries a short raw reason). */
export type FriendlyError = { kind: 'error' | 'cancelled'; message: string; generic?: true };

/** Native gas (CELO) is short. Injected and WalletConnect wallets pay fees in CELO. */
export const MSG_FEES = 'Add a little CELO to pay network fees.';
/** MiniPay pays fees in stablecoins (fee-currency); its errors say "fee-currency" / "User not authenticated". */
export const MSG_FEES_STABLE = 'Add a little USD₮ or USDC to pay network fees.';
export const MSG_BALANCE = "You don't have enough of this token.";
export const MSG_CANCELLED = 'You cancelled this in your wallet.';
export const MSG_VAULT_EXISTS = 'You already have a vault. Taking you to deposit…';
export const MSG_TIMEOUT = "Still confirming on the network. This can take a minute, so we'll keep checking.";
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
  if (names.includes('WrongChainError')) {
    let cur: unknown = e;
    for (let i = 0; i < 8 && cur && typeof cur === 'object' && (cur as ErrLike).name !== 'WrongChainError'; i++) cur = (cur as ErrLike).cause;
    const m = (cur as ErrLike | undefined)?.message;
    return { kind: 'error', message: typeof m === 'string' && m ? m : 'Switch to the right network in your wallet, then try again.' };
  }
  if (/0x4239717c|VaultExists/i.test(text)) return { kind: 'error', message: MSG_VAULT_EXISTS };
  if (/timed out waiting for confirmation/i.test(text)) return { kind: 'error', message: MSG_TIMEOUT };
  if (/fee-?currency|user not authenticated/i.test(text)) return { kind: 'error', message: MSG_FEES_STABLE };
  // Token (not gas) shortfalls first: the vault's InsufficientBalance error (case-sensitive) and ERC20 reverts.
  if (/0xf4d678b8|InsufficientBalance\b/.test(text) || /transfer amount exceeds/i.test(text)) {
    return { kind: 'error', message: MSG_BALANCE };
  }
  if (isNativeGas(codes, names, text)) return { kind: 'error', message: MSG_FEES };
  if (/exceeds balance/i.test(text)) return { kind: 'error', message: MSG_BALANCE };
  const why = shortReason(e);
  return { kind: 'error', message: why ? `${MSG_GENERIC} (${why})` : MSG_GENERIC, generic: true };
}

/** Not enough native CELO for gas: viem, geth/-32000, and wallet (OKX, MetaMask) phrasings. */
const GAS_RE = new RegExp([
  'insufficient funds', 'funds for gas', 'for gas \\* price', 'gas required exceeds', 'intrinsic gas',
  'exceeds the balance of the account', // viem InsufficientFundsError
  'insufficient (?:native |celo )?balance (?:for|to pay) (?:the )?(?:gas|network fee|transaction fee|fee)',
  'insufficient (?:gas|celo)', 'not enough (?:celo|gas|balance for (?:gas|fee|network fee))',
  '(?:gas|network) fee[^.]{0,40}(?:insufficient|not enough)',
].join('|'), 'i');

function isNativeGas(codes: unknown[], names: string[], text: string): boolean {
  if (names.includes('InsufficientFundsError')) return true;
  if (GAS_RE.test(text)) return true;
  const rpc = codes.some((c) => c === -32000 || c === '-32000' || c === -32003 || c === '-32003');
  return rpc && /insufficient|balance|gas/i.test(text) && !/0xf4d678b8|transfer amount exceeds/i.test(text);
}

/** viem shortMessage (or message) for diagnosis, first line, trimmed to ~120 chars. */
export function shortReason(e: unknown, max = 120): string {
  if (e == null) return '';
  const x = e as { shortMessage?: unknown; message?: unknown };
  const raw = typeof e === 'string' ? e : typeof x.shortMessage === 'string' && x.shortMessage ? x.shortMessage
    : typeof x.message === 'string' ? x.message : '';
  const one = raw.split('\n')[0].replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

/** Map a raw wallet/RPC error to a friendly message. Always logs the raw error. */
export function friendlyError(e: unknown): FriendlyError {
  console.error(e);
  return classifyError(e);
}

/** Create-vault outcome: VaultExists and a receipt timeout are not errors from the user's point of view. */
export type CreateOutcome =
  | { kind: 'exists'; message: string }
  | { kind: 'pending'; message: string }
  | FriendlyError;

export function classifyCreateError(e: unknown): CreateOutcome {
  const f = classifyError(e);
  if (f.message === MSG_VAULT_EXISTS) return { kind: 'exists', message: MSG_VAULT_EXISTS };
  if (f.message === MSG_TIMEOUT) return { kind: 'pending', message: MSG_TIMEOUT };
  return f;
}
