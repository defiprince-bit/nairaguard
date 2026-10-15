'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import s from './ConnectSheet.module.css';
import a from './AvatarPicker.module.css';
import { AvatarPicker, WalletAvatar } from './AvatarPicker';
import { ConnectSheet } from './ConnectSheet';
import { disconnectWallet, shorten, useWallet } from '../lib/wallet';

/** Header wallet menu (outside MiniPay only): switch wallet / disconnect. Inside MiniPay, renders the trigger as-is. */
export function WalletMenu({ trigger }: { trigger: ReactNode }) {
  const { address, label, miniPay } = useWallet();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  async function onDisconnect() {
    setOpen(false);
    await disconnectWallet();
    router.replace('/app');
  }

  if (miniPay || !address) return <>{trigger}</>;
  return (
    <div className={s.menuWrap} ref={ref}>
      <button type="button" className={s.menuBtn} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
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
