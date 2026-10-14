'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { CHAIN } from './overview';

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

export function isMiniPay(): boolean {
  return typeof window !== 'undefined' && !!window.ethereum?.isMiniPay;
}

export function shorten(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
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
  const onAcc = (a: string[]) => set({ address: (a?.[0] as `0x${string}`) ?? null });
  const onChain = (c: string | number) => set({ chainId: Number(c) });
  const onDisc = () => { if (state.kind !== 'minipay') set({ address: null }); };
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

async function activate(provider: EthProvider, kind: ConnectorKind, label: string, request: boolean) {
  const accounts = (await provider.request({ method: request ? 'eth_requestAccounts' : 'eth_accounts' })) as string[];
  if (!accounts?.[0]) return false;
  attach(provider);
  set({ provider, kind, label, address: accounts[0] as `0x${string}`, chainId: await readChain(provider) });
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
      url: typeof window !== 'undefined' ? window.location.origin : 'https://nairaguard-vert.vercel.app',
      icons: ['https://nairaguard-vert.vercel.app/logo-v2.svg'],
    },
  });
  wcProvider = p as unknown as EthProvider;
  return wcProvider;
}

export async function connectInjected(w: DiscoveredWallet) {
  return activate(w.provider, 'injected', w.name, true);
}

export async function connectWalletConnect(label = 'WalletConnect') {
  if (!WC_PROJECT_ID) throw new Error('WalletConnect is not set up yet.');
  const p = (await getWalletConnect()) as EthProvider & { connect?: () => Promise<void>; session?: unknown };
  if (!p.session) await p.connect?.();
  return activate(p, 'walletconnect', label, false);
}

export async function disconnectWallet() {
  const p = state.provider;
  try { localStorage.removeItem(LAST_KEY); } catch {}
  detach?.();
  detach = null;
  if (state.kind === 'walletconnect') await p?.disconnect?.().catch(() => {});
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
/** MiniPay: unchanged auto-connect. Elsewhere: silently restore the last wallet if it is still authorised. */
async function boot() {
  if (booted || typeof window === 'undefined') return;
  booted = true;
  const eth = window.ethereum;
  if (eth?.isMiniPay) {
    await activate(eth, 'minipay', 'MiniPay', true).catch(() => false);
    return;
  }
  let last: { kind?: ConnectorKind; label?: string } = {};
  try { last = JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}'); } catch {}
  if (last.kind === 'walletconnect' && WC_PROJECT_ID) {
    const p = (await getWalletConnect().catch(() => null)) as (EthProvider & { session?: unknown }) | null;
    if (p?.session) await activate(p, 'walletconnect', last.label ?? 'WalletConnect', false).catch(() => false);
  } else if (last.kind === 'injected' && eth) {
    await activate(eth, 'injected', last.label ?? 'Browser wallet', false).catch(() => false);
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
      if (!(await activate(eth, eth.isMiniPay ? 'minipay' : 'injected', eth.isMiniPay ? 'MiniPay' : 'Browser wallet', true))) setError('No account returned.');
    } catch {
      setError('Wallet connection was cancelled.');
    } finally {
      setConnecting(false);
    }
  }, []);

  const wrongChain = !miniPay && !!s.address && s.chainId !== null && s.chainId !== CHAIN_ID;
  return { address: s.address, kind: s.kind, label: s.label, chainId: s.chainId, wrongChain, miniPay, booting, connecting, error, connect, setError };
}
