'use client';

import { useEffect, useState } from 'react';
import s from './ConnectSheet.module.css';
import {
  type DiscoveredWallet,
  type EthProvider,
  LoginSignatureRejectedError,
  MSG_LOGIN_REJECTED,
  WC_PROJECT_ID,
  connectInjected,
  connectWalletConnect,
  discoverWallets,
} from '../lib/wallet';

const isValora = (w: DiscoveredWallet) => /valora/i.test(w.rdns) || /valora/i.test(w.name);
const isOkx = (w: DiscoveredWallet) => w.rdns === 'com.okex.wallet' || /okx/i.test(w.name);

/** Bundled official logos (see public/wallets/SOURCES.md). EIP-6963 icons win when a wallet announces one. */
const ICON = { valora: '/wallets/valora.png', metamask: '/wallets/metamask.svg', okx: '/wallets/okx.png', wc: '/wallets/walletconnect.svg' };
const fallbackIcon = (w: DiscoveredWallet) => (/metamask/i.test(w.rdns) || /metamask/i.test(w.name) ? ICON.metamask : '');

/** Legacy OKX injection for builds without EIP-6963. */
function okxLegacy(): DiscoveredWallet | null {
  if (typeof window === 'undefined') return null;
  const p = (window as unknown as { okxwallet?: EthProvider }).okxwallet;
  return p ? { uuid: 'okx-legacy', name: 'OKX Wallet', icon: '', rdns: 'com.okex.wallet', provider: p } : null;
}
const isMobile = () => typeof navigator !== 'undefined' && /android|iphone|ipad|ipod/i.test(navigator.userAgent);
/** OKX's universal link: opens this page in the OKX app's dApp browser, or the OKX download page if it isn't installed. */
const okxDeepLink = () => `https://www.okx.com/download?deeplink=${encodeURIComponent(`okx://wallet/dapp/url?dappUrl=${encodeURIComponent(window.location.href)}`)}`;

/** "Connect wallet" — bottom sheet on mobile, centred modal on desktop. Never shown inside MiniPay. */
export function ConnectSheet({ onClose, onConnected }: { onClose: () => void; onConnected?: () => void }) {
  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [okxLegacyW, setOkxLegacyW] = useState<DiscoveredWallet | null>(null);
  const [mobile, setMobile] = useState(false);

  useEffect(() => discoverWallets(setWallets), []);
  useEffect(() => { setOkxLegacyW(okxLegacy()); setMobile(isMobile()); }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  async function run(id: string, fn: () => Promise<boolean>) {
    setBusy(id);
    setError(null);
    try {
      if (await fn()) { onConnected?.(); onClose(); }
      else setError('No account was shared. Try again.');
    } catch (e) {
      if (e instanceof LoginSignatureRejectedError) {
        setError(MSG_LOGIN_REJECTED);
      } else {
        const code = (e as { code?: number }).code;
        setError(code === 4001 ? 'Connection cancelled. You can try again any time.' : 'Couldn\u2019t connect that wallet. Try again or pick another.');
      }
    } finally {
      setBusy(null);
    }
  }

  const valoraInjected = wallets.find(isValora);
  const okxW = wallets.find(isOkx) ?? okxLegacyW;
  const others = wallets.filter((w) => !isValora(w) && !isOkx(w));
  const wc = !!WC_PROJECT_ID;
  const okxHint = okxW ? 'Detected in this browser' : mobile ? 'Open in the OKX app (or install it)' : wc ? 'Scan with the OKX Wallet app' : 'Install the OKX Wallet extension';
  function connectOkx() {
    if (okxW) return run('okx', () => connectInjected(okxW));
    if (mobile) { window.location.href = okxDeepLink(); return; }
    if (wc) return run('okx', () => connectWalletConnect('OKX Wallet'));
    window.open('https://web3.okx.com/download', '_blank', 'noopener');
  }

  return (
    <div className={s.back} role="dialog" aria-modal="true" aria-label="Connect wallet" onClick={onClose}>
      <div className={s.sheet} onClick={(e) => e.stopPropagation()}>
        <div className={s.grab} aria-hidden />
        <div className={s.head}>
          <h2 className={s.title}>Connect wallet</h2>
          <button type="button" className={s.x} onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className={s.sub}>Pick the wallet that holds your cNGN or USD₮. Your vault belongs to this address. You will sign a short login message (MiniPay skips this).</p>
        <div className={s.list}>
          {valoraInjected || wc ? (
            <button type="button" className={s.opt} disabled={!!busy}
              onClick={() => run('valora', () => (valoraInjected ? connectInjected(valoraInjected) : connectWalletConnect('Valora')))}>
              <span className={`${s.ic} ${s.valora}`}><img src={ICON.valora} alt="" /></span>
              <span className={s.meta}>Valora<small>{busy === 'valora' ? 'Check your wallet…' : valoraInjected ? 'Detected in this browser' : 'Scan with the Valora app'}</small></span>
              <span className={s.chev}>›</span>
            </button>
          ) : null}
          <button type="button" className={s.opt} disabled={!!busy} onClick={connectOkx}>
            <span className={`${s.ic} ${s.okx}`}><img src={okxW?.icon || ICON.okx} alt="" /></span>
            <span className={s.meta}>OKX Wallet<small>{busy === 'okx' ? 'Check your wallet…' : okxHint}</small></span>
            <span className={s.chev}>›</span>
          </button>
          {others.map((w) => (
            <button key={w.uuid} type="button" className={s.opt} disabled={!!busy} onClick={() => run(w.uuid, () => connectInjected(w))}>
              <span className={`${s.ic} ${s.mm}`}>{w.icon || fallbackIcon(w) ? <img src={w.icon || fallbackIcon(w)} alt="" /> : 'W'}</span>
              <span className={s.meta}>{w.name}<small>{busy === w.uuid ? 'Check your wallet…' : 'Browser extension'}</small></span>
              <span className={s.chev}>›</span>
            </button>
          ))}
          {!others.length ? (
            <button type="button" className={s.opt} disabled>
              <span className={`${s.ic} ${s.mm} ${s.pad}`}><img src={ICON.metamask} alt="" /></span>
              <span className={s.meta}>MetaMask / browser wallet<small>No browser wallet found</small></span>
            </button>
          ) : null}
          {wc ? (
            <button type="button" className={s.opt} disabled={!!busy} onClick={() => run('wc', () => connectWalletConnect())}>
              <span className={`${s.ic} ${s.wc} ${s.pad}`}><img src={ICON.wc} alt="" /></span>
              <span className={s.meta}>WalletConnect<small>{busy === 'wc' ? 'Showing QR code…' : 'Scan a QR code with any wallet'}</small></span>
              <span className={s.chev}>›</span>
            </button>
          ) : null}
        </div>
        {error ? <p className={s.err} role="alert">{error}</p> : null}
        <p className={s.note}>On your phone? Open NairaGuard inside MiniPay for one-tap setup.</p>
      </div>
    </div>
  );
}
