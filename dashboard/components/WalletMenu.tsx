'use client';

import { ReactNode, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import s from './ConnectSheet.module.css';
import a from './AvatarPicker.module.css';
import { AvatarPicker, WalletAvatar } from './AvatarPicker';
import { ConnectSheet } from './ConnectSheet';
import { disconnectWallet, shorten, useWallet } from '../lib/wallet';

/** Header wallet control. Outside MiniPay: switch wallet / disconnect. Inside MiniPay: avatar picker only. */
export function WalletMenu({ trigger }: { trigger: ReactNode }) {
  const { address, label, miniPay } = useWallet();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      btnRef.current?.focus();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  useEffect(() => {
    if (!open || !panelRef.current) return;
    const selected = panelRef.current.querySelector<HTMLElement>('[aria-pressed="true"]');
    (selected ?? panelRef.current).focus();
  }, [open]);

  function keepFocusIn(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Tab') return;
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled])')];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === e.currentTarget)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  async function onDisconnect() {
    setOpen(false);
    await disconnectWallet();
    router.replace('/app');
  }

  if (!address) return <>{trigger}</>;
  if (miniPay) {
    return (
      <div className={s.menuWrap} ref={ref}>
        <button
          ref={btnRef}
          type="button"
          className={s.menuBtn}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Choose avatar for ${shorten(address)}`}
          onClick={() => setOpen((o) => !o)}
        >
          <span className={a.affordance}>
            {trigger}
            <span className={a.caret} aria-hidden>▾</span>
          </span>
        </button>
        {open ? (
          <>
            <div className={a.scrim} onMouseDown={() => { setOpen(false); btnRef.current?.focus(); }} />
            <div
              ref={panelRef}
              className={a.mini}
              role="dialog"
              aria-modal="true"
              aria-label="Choose your avatar"
              tabIndex={-1}
              onKeyDown={keepFocusIn}
            >
              <span className={a.grab} aria-hidden />
              <div className={s.menuHead}>
                <span className={a.idRow}>
                  <WalletAvatar address={address} size={44} decorative />
                  <span><b>{shorten(address)}</b>MiniPay</span>
                </span>
              </div>
              <AvatarPicker address={address} />
            </div>
          </>
        ) : null}
      </div>
    );
  }
  return (
    <div className={s.menuWrap} ref={ref}>
      <button ref={btnRef} type="button" className={s.menuBtn} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {trigger}
      </button>
      {open ? (
        <div className={s.menu} role="menu">
          <div className={s.menuHead}>
            <span className={a.idRow}>
              <WalletAvatar address={address} size={44} decorative />
              <span><b>{shorten(address)}</b>{label ?? 'Wallet'}</span>
            </span>
          </div>
          <AvatarPicker address={address} />
          <button type="button" role="menuitem" className={s.menuItem} onClick={() => { setOpen(false); setSheet(true); }}>Switch wallet</button>
          <button type="button" role="menuitem" className={`${s.menuItem} ${s.danger}`} onClick={() => { void onDisconnect(); }}>Disconnect</button>
        </div>
      ) : null}
      {sheet ? <ConnectSheet onClose={() => setSheet(false)} /> : null}
    </div>
  );
}

export function SwitchNetworkBar({ onSwitch, busy, chainName }: { onSwitch: () => void; busy: boolean; chainName: string }) {
  return (
    <div className={s.switchBar} role="alert">
      <span>Your wallet is on a different network. NairaGuard runs on {chainName}.</span>
      <button type="button" className={s.chipBtn} style={{ alignSelf: 'flex-start', background: 'var(--solid)', color: 'var(--solid-ink)', border: 0, minHeight: 44, padding: '10px 18px' }} onClick={onSwitch} disabled={busy}>
        {busy ? 'Check your wallet…' : `Switch to ${chainName}`}
      </button>
    </div>
  );
}
