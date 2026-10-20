'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { CHAIN } from './overview';
import {
  clearSession,
  hasValidSession,
  requestLoginSignature,
} from './session';

export type EthProvider = {
  isMiniPay?: boolean;
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, fn: (...a: any[]) => void) => void;
  removeListener?: (event: string, fn: (...a: any[]) => void) => void;
  disconnect?: () => Promise<void>;
};

declare global {
  interface Window {
    ethereum?: EthProvider;
  }
}

export type ConnectorKind = 'minipay' | 'injected' | 'walletconnect';

/** EIP-6963 announced wallet. */
export type DiscoveredWallet = { uuid: string; name: string; icon: string; rdns: string; provider: EthProvider };

export const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '';
export const CHAIN_ID = CHAIN.id;
export const CHAIN_NAME = CHAIN.id === 42220 ? 'Celo' : 'Celo Sepolia';
const LAST_KEY = 'ng.lastConnector';

export const MSG_LOGIN_SIGN = 'Sign the short login message in your wallet to continue.';
export const MSG_LOGIN_REJECTED = 'You cancelled the login signature. Try again when you are ready.';

export class LoginSignatureRejectedError extends Error {
  code = 4001 as const;
  constructor(message = MSG_LOGIN_REJECTED) {
    super(message);
    this.name = 'LoginSignatureRejectedError';
  }
}

export function isMiniPay(): boolean {
  return typeof window !== 'undefined' && !!window.ethereum?.isMiniPay;
}

export function shorten(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function sessionStore(): Storage | null {
  if (typeof window === 'undefined') return null;
  try { return window.sessionStorage; } catch { return null; }
}

function clearLoginSession() {
  const s = sessionStore();
  if (s) clearSession(s);
}

function sessionOk(address: string): boolean {
  const s = sessionStore();
  return !!s && hasValidSession(s, address);
}

/** True when the store has an address that is MiniPay or has a signed session. */
export function sessionReady(): boolean {
  if (!state.address) return false;
  if (state.kind === 'minipay') return true;
  return sessionOk(state.address);
}

/* ---------------- shared store: one active provider for every read/write ---------------- */
type State = { provider: EthProvider | null; kind: ConnectorKind | null; label: string | null; address: `0x${string}` | null; chainId: number | null };
let state: State = { provider: null, kind: null, label: null, address: null, chainId: null };
const subs = new Set<() => void>();
function set(p: Partial<State>) { state = { ...state, ...p }; subs.forEach((f) => f()); }
const subscribe = (f: () => void) => { subs.add(f); return () => subs.delete(f); };
const snap = () => state;
const EMPTY = state;

/** The provider every write goes through: the connected one, else MiniPay/injected window.ethereum. */
export function getProvider(): EthProvider | undefined {
  return state.provider ?? (typeof window !== 'undefined' ? window.ethereum : undefined);
}

let detach: (() => void) | null = null;
function attach(provider: EthProvider) {
  detach?.();
  const onAcc = (a: string[]) => {
    const next = (a?.[0] as `0x${string}`) ?? null;
    if (!next) {
      clearLoginSession();
      set({ address: null });
      return;
    }
    if (state.kind === 'minipay') {
      set({ address: next });
      return;
    }
    // Account switch without a matching signed session → log out.
    if (sessionOk(next)) {
      set({ address: next });
      return;
    }
    clearLoginSession();
    try { localStorage.removeItem(LAST_KEY); } catch {}
    detach?.();
    detach = null;
    set({ provider: null, kind: null, label: null, address: null, chainId: null });
  };
  const onChain = (c: string | number) => set({ chainId: Number(c) });
  const onDisc = () => {
    if (state.kind === 'minipay') return;
    clearLoginSession();
    try { localStorage.removeItem(LAST_KEY); } catch {}
    set({ provider: null, kind: null, label: null, address: null, chainId: null });
  };
  provider.on?.('accountsChanged', onAcc);
  provider.on?.('chainChanged', onChain);
  provider.on?.('disconnect', onDisc);
  detach = () => {
    provider.removeListener?.('accountsChanged', onAcc);
    provider.removeListener?.('chainChanged', onChain);
    provider.removeListener?.('disconnect', onDisc);
  };
}

async function readChain(p: EthProvider): Promise<number | null> {
  try { return Number(await p.request({ method: 'eth_chainId' })); } catch { return null; }
}

/** Ask for a one-time personal_sign login. MiniPay skips this (cannot sign messages). */
async function requireLoginSignature(provider: EthProvider, address: string, chainId: number) {
  const store = sessionStore();
  if (!store) throw new Error('Session storage is unavailable.');
  try {
    await requestLoginSignature(provider.request.bind(provider), store, address, chainId);
  } catch (e) {
    const code = (e as { code?: number }).code;
    if (code === 4001) throw new LoginSignatureRejectedError();
    throw e;
  }
}

type ActivateOpts = { request: boolean; /** Skip personal_sign (boot restore with valid session, or MiniPay). */ skipSign?: boolean };

async function activate(provider: EthProvider, kind: ConnectorKind, label: string, opts: ActivateOpts) {
  const accounts = (await provider.request({ method: opts.request ? 'eth_requestAccounts' : 'eth_accounts' })) as string[];
  if (!accounts?.[0]) return false;
  const address = accounts[0] as `0x${string}`;
  const chainId = (await readChain(provider)) ?? CHAIN_ID;

  if (kind !== 'minipay' && !opts.skipSign) {
    await requireLoginSignature(provider, address, chainId);
  }

  attach(provider);
  set({ provider, kind, label, address, chainId });
  if (kind !== 'minipay') try { localStorage.setItem(LAST_KEY, JSON.stringify({ kind, label })); } catch {}
  return true;
}

/** EIP-6963 discovery, falling back to window.ethereum as one "Browser wallet". */
export function discoverWallets(onChange: (w: DiscoveredWallet[]) => void): () => void {
  const found = new Map<string, DiscoveredWallet>();
  const handler = (e: Event) => {
    const d = (e as CustomEvent).detail as { info: Omit<DiscoveredWallet, 'provider'>; provider: EthProvider };
    if (!d?.info?.uuid || found.has(d.info.rdns)) return;
    found.set(d.info.rdns, { ...d.info, provider: d.provider });
    onChange([...found.values()]);
  };
  window.addEventListener('eip6963:announceProvider', handler);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  const t = setTimeout(() => {
    if (!found.size && window.ethereum && !window.ethereum.isMiniPay) {
      onChange([{ uuid: 'injected', name: 'Browser wallet', icon: '', rdns: 'injected', provider: window.ethereum }]);
    }
  }, 300);
  return () => { clearTimeout(t); window.removeEventListener('eip6963:announceProvider', handler); };
}

let wcProvider: EthProvider | null = null;
async function getWalletConnect(): Promise<EthProvider> {
  if (wcProvider) return wcProvider;
  const { EthereumProvider } = await import('@walletconnect/ethereum-provider');
  const p = await EthereumProvider.init({
    projectId: WC_PROJECT_ID,
    chains: [CHAIN_ID],
    showQrModal: true,
    metadata: {
      name: 'NairaGuard',
      description: 'Your naira, guarded by an agent with limits you set.',
      url: typeof window !== 'undefined' ? window.location.origin : 'https://nairaguard.space',
      icons: ['https://nairaguard.space/logo-v2.svg'],
    },
  });
  wcProvider = p as unknown as EthProvider;
  return wcProvider;
}

export async function connectInjected(w: DiscoveredWallet) {
  try {
    return await activate(w.provider, 'injected', w.name, { request: true });
  } catch (e) {
    if (e instanceof LoginSignatureRejectedError) {
      await revokeQuietly(w.provider, 'injected');
    }
    throw e;
  }
}

export async function connectWalletConnect(label = 'WalletConnect') {
  if (!WC_PROJECT_ID) throw new Error('WalletConnect is not set up yet.');
  const p = (await getWalletConnect()) as EthProvider & { connect?: () => Promise<void>; session?: unknown };
  if (!p.session) await p.connect?.();
  try {
    return await activate(p, 'walletconnect', label, { request: false });
  } catch (e) {
    if (e instanceof LoginSignatureRejectedError) {
      await revokeQuietly(p, 'walletconnect');
    }
    throw e;
  }
}

async function revokeQuietly(p: EthProvider | null | undefined, kind: ConnectorKind | null) {
  clearLoginSession();
  try { localStorage.removeItem(LAST_KEY); } catch {}
  detach?.();
  detach = null;
  if (kind === 'walletconnect') await p?.disconnect?.().catch(() => {});
  else await p?.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] }).catch(() => {});
  set({ provider: null, kind: null, label: null, address: null, chainId: null });
}

export async function disconnectWallet() {
  const p = state.provider;
  const kind = state.kind;
  clearLoginSession();
  try { localStorage.removeItem(LAST_KEY); } catch {}
  detach?.();
  detach = null;
  if (kind === 'walletconnect') await p?.disconnect?.().catch(() => {});
  else await p?.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] }).catch(() => {});
  set({ provider: null, kind: null, label: null, address: null, chainId: null });
}

/** Ask the wallet to move to the app's chain (adds Celo / Celo Sepolia if it doesn't know it). */
export async function switchToAppChain(p: EthProvider | undefined = getProvider()) {
  if (!p) throw new Error('No wallet found.');
  const hex = `0x${CHAIN_ID.toString(16)}`;
  try {
    await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
  } catch (e) {
    if ((e as { code?: number }).code !== 4902) throw e;
    await p.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: hex, chainName: CHAIN_NAME, nativeCurrency: CHAIN.nativeCurrency,
        rpcUrls: CHAIN.rpcUrls.default.http, blockExplorerUrls: CHAIN.blockExplorers ? [CHAIN.blockExplorers.default.url] : [],
      }],
    });
  }
  set({ chainId: CHAIN_ID });
}

let booted = false;
/**
 * MiniPay: unchanged auto-connect (no personal_sign — MiniPay cannot sign messages).
 * Elsewhere: silently restore LAST_KEY only when a valid sessionStorage login exists for that address.
 */
async function boot() {
  if (booted || typeof window === 'undefined') return;
  booted = true;
  const eth = window.ethereum;
  if (eth?.isMiniPay) {
    await activate(eth, 'minipay', 'MiniPay', { request: true, skipSign: true }).catch(() => false);
    return;
  }
  let last: { kind?: ConnectorKind; label?: string } = {};
  try { last = JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}'); } catch {}

  if (last.kind === 'walletconnect' && WC_PROJECT_ID) {
    const p = (await getWalletConnect().catch(() => null)) as (EthProvider & { session?: unknown }) | null;
    if (!p?.session) return;
    const accounts = (await p.request({ method: 'eth_accounts' }).catch(() => [])) as string[];
    if (!accounts?.[0] || !sessionOk(accounts[0])) return;
    await activate(p, 'walletconnect', last.label ?? 'WalletConnect', { request: false, skipSign: true }).catch(() => false);
  } else if (last.kind === 'injected' && eth) {
    const accounts = (await eth.request({ method: 'eth_accounts' }).catch(() => [])) as string[];
    if (!accounts?.[0] || !sessionOk(accounts[0])) return;
    await activate(eth, 'injected', last.label ?? 'Browser wallet', { request: false, skipSign: true }).catch(() => false);
  }
}

export function useWallet() {
  const s = useSyncExternalStore(subscribe, snap, () => EMPTY);
  const [miniPay, setMiniPay] = useState(false);
  const [booting, setBooting] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMiniPay(isMiniPay());
    boot().finally(() => setBooting(false));
  }, []);

  /** MiniPay retry path (unchanged behaviour). */
  const connect = useCallback(async () => {
    const eth = typeof window !== 'undefined' ? window.ethereum : undefined;
    if (!eth) return setError('No wallet found.');
    setConnecting(true);
    setError(null);
    try {
      const kind: ConnectorKind = eth.isMiniPay ? 'minipay' : 'injected';
      const label = eth.isMiniPay ? 'MiniPay' : 'Browser wallet';
      if (!(await activate(eth, kind, label, { request: true, skipSign: kind === 'minipay' }))) setError('No account returned.');
    } catch (e) {
      if (e instanceof LoginSignatureRejectedError) setError(e.message);
      else setError('Wallet connection was cancelled.');
    } finally {
      setConnecting(false);
    }
  }, []);

  const wrongChain = !miniPay && !!s.address && s.chainId !== null && s.chainId !== CHAIN_ID;
  const ready = !!s.address && (miniPay || s.kind === 'minipay' || sessionOk(s.address));
  return {
    address: s.address,
    kind: s.kind,
    label: s.label,
    chainId: s.chainId,
    wrongChain,
    miniPay,
    booting,
    connecting,
    error,
    connect,
    setError,
    sessionReady: ready,
  };
}
