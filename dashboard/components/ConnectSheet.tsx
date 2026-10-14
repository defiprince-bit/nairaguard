'use client';

import { useEffect, useState } from 'react';
import s from './ConnectSheet.module.css';
import { type DiscoveredWallet, WC_PROJECT_ID, connectInjected, connectWalletConnect, discoverWallets } from '../lib/wallet';

const isValora = (w: DiscoveredWallet) => /valora/i.test(w.rdns) || /valora/i.test(w.name);

/** "Connect wallet" — bottom sheet on mobile, centred modal on desktop. Never shown inside MiniPay. */
export function ConnectSheet({ onClose, onConnected }: { onClose: () => void; onConnected?: () => void }) {
  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => discoverWallets(setWallets), []);
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
      const code = (e as { code?: number }).code;
      setError(code === 4001 ? 'Connection cancelled. You can try again any time.' : 'Couldn\u2019t connect that wallet. Try again or pick another.');
    } finally {
      setBusy(null);
    }
  }

  const valoraInjected = wallets.find(isValora);
  const others = wallets.filter((w) => !isValora(w));
  const wc = !!WC_PROJECT_ID;

  return (
    <div className={s.back} role="dialog" aria-modal="true" aria-label="Connect wallet" onClick={onClose}>
      <div className={s.sheet} onClick={(e) => e.stopPropagation()}>
        <div className={s.grab} aria-hidden />
        <div className={s.head}>
          <h2 className={s.title}>Connect wallet</h2>
          <button type="button" className={s.x} onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className={s.sub}>Pick the wallet that holds your cNGN or USD₮. Your vault belongs to this address.</p>
        <div className={s.list}>
          {valoraInjected || wc ? (
            <button type="button" className={s.opt} disabled={!!busy}
              onClick={() => run('valora', () => (valoraInjected ? connectInjected(valoraInjected) : connectWalletConnect('Valora')))}>
              <span className={`${s.ic} ${s.valora}`}>V</span>
              <span className={s.meta}>Valora<small>{busy === 'valora' ? 'Opening Valora…' : valoraInjected ? 'Detected in this browser' : 'Scan with the Valora app'}</small></span>
              <span className={s.chev}>›</span>
            </button>
          ) : null}
          {others.map((w) => (
            <button key={w.uuid} type="button" className={s.opt} disabled={!!busy} onClick={() => run(w.uuid, () => connectInjected(w))}>
              <span className={`${s.ic} ${s.mm}`}>{w.icon ? <img src={w.icon} alt="" /> : 'W'}</span>
              <span className={s.meta}>{w.name}<small>{busy === w.uuid ? 'Check your wallet…' : 'Browser extension'}</small></span>
              <span className={s.chev}>›</span>
            </button>
          ))}
          {!others.length ? (
            <button type="button" className={s.opt} disabled>
              <span className={`${s.ic} ${s.mm}`}>M</span>
              <span className={s.meta}>MetaMask / browser wallet<small>No browser wallet found</small></span>
            </button>
          ) : null}
          {wc ? (
            <button type="button" className={s.opt} disabled={!!busy} onClick={() => run('wc', () => connectWalletConnect())}>
              <span className={`${s.ic} ${s.wc}`}>⌁</span>
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
