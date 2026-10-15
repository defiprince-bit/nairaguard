'use client';

import { useSyncExternalStore, type CSSProperties } from 'react';
import { initials } from '../lib/overviewView';
import {
  AVATAR_PRESETS,
  faceFor,
  loadAvatarChoice,
  saveAvatarChoice,
  subscribeAvatar,
  type AvatarChoice,
  type AvatarPresetId,
} from '../lib/avatar';
import { shorten } from '../lib/wallet';
import a from './AvatarPicker.module.css';

function Mark({ id }: { id: AvatarPresetId }) {
  const stroke = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (id) {
    case 'shield':
      return (
        <svg className={a.mark} viewBox="0 0 24 24" aria-hidden>
          <path fill="currentColor" fillRule="evenodd" d="M12 2.15 20.1 5.4v6.5c0 4.75-3.25 8-8.1 9.95-4.85-1.95-8.1-5.2-8.1-9.95V5.4L12 2.15zm-.15 11.35 3.85-3.95-1.35-1.3-2.55 2.6-1.35-1.3-1.3 1.35 2.7 2.6z" />
        </svg>
      );
    case 'naira':
      return (
        <svg className={a.markNaira} viewBox="0 0 24 24" aria-hidden>
          <path fill="none" stroke="currentColor" strokeWidth="2.15" strokeLinecap="square" strokeLinejoin="miter" d="M7.2 4.6v14.8M16.8 4.6v14.8M7.2 4.6 16.8 19.4" />
          <path fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="square" d="M4.4 9h15.2M4.4 14.2h15.2" />
        </svg>
      );
    case 'leaf':
      return (
        <svg className={a.mark} viewBox="0 0 24 24" aria-hidden>
          <path fill="currentColor" d="M19.7 4.2C12.2 4.6 6.4 8.2 4.3 19.4c4.2-.6 8.6-2.6 11.6-6.2 2.2-2.6 3.4-5.8 3.8-9z" />
          <path d="M8.2 15.4c2.3-2.1 4.5-3.8 7.3-5.2" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth={1.6} strokeLinecap="round" />
        </svg>
      );
    case 'bolt':
      return (
        <svg className={a.mark} viewBox="0 0 24 24" aria-hidden>
          <path fill="currentColor" d="M13.15 1.7 4.2 13.15h6.15l-1.15 9.15 9.6-12.35h-6.2l.55-8.25z" />
        </svg>
      );
    case 'eagle':
      return (
        <svg className={a.mark} viewBox="0 0 24 24" aria-hidden>
          <path fill="currentColor" d="M12 15.6c-1.35 0-2.7.45-4.05 1.45C6.3 13.7 5.1 10.2 6.4 6.7 8.5 9.2 10.2 10.4 12 10.4s3.5-1.2 5.6-3.7c1.3 3.5.1 7-1.55 10.35A8.2 8.2 0 0 0 12 15.6z" />
          <path fill="currentColor" d="M11.15 16.2h1.7v3.15c0 .85-.4 1.45-.85 1.45s-.85-.6-.85-1.45V16.2z" />
        </svg>
      );
    case 'globe':
      return (
        <svg className={a.mark} viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="12" r="8" {...stroke} />
          <path d="M4 12h16M12 4c2.35 2.35 3.5 5 3.5 8s-1.15 5.65-3.5 8c-2.35-2.35-3.5-5-3.5-8s1.15-5.65 3.5-8z" {...stroke} />
        </svg>
      );
    case 'gem':
      return (
        <svg className={a.mark} viewBox="0 0 24 24" aria-hidden>
          <path d="M4.2 9.3 8.3 4.2h7.4l4.1 5.1L12 20.2 4.2 9.3z" {...stroke} />
          <path d="M4.2 9.3h15.6M8.3 4.2 12 9.3 15.7 4.2M9.4 9.3 12 20.2M14.6 9.3 12 20.2" {...stroke} />
        </svg>
      );
    case 'moon':
      return (
        <svg className={a.mark} viewBox="0 0 24 24" aria-hidden>
          <path fill="currentColor" d="M14.8 3.3A7.7 7.7 0 1 0 20.8 15 6 6 0 0 1 14.8 3.3z" />
        </svg>
      );
    case 'sun':
      return (
        <svg className={a.mark} viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="12" r="3.35" fill="currentColor" />
          <path d="M12 2.3v2.35M12 19.35V21.7M4.55 4.55l1.65 1.65M17.8 17.8l1.65 1.65M2.3 12h2.35M19.35 12H21.7M4.55 19.45l1.65-1.65M17.8 6.2l1.65-1.65" {...stroke} />
        </svg>
      );
    case 'rocket':
      return (
        <svg className={a.mark} viewBox="0 0 24 24" aria-hidden>
          <path d="M12 2.6c2.3 2.6 3.3 5.6 3.3 8.2L12 14.6 8.7 10.8c0-2.6 1-5.6 3.3-8.2z" {...stroke} />
          <path d="M9 12.4 6.4 16.6l3.2-1.2M15 12.4l2.6 4.2-3.2-1.2" {...stroke} />
          <circle cx="12" cy="8.2" r="1.15" fill="currentColor" />
        </svg>
      );
    case 'lion':
      return (
        <svg className={a.markLion} viewBox="0 0 24 24" aria-hidden>
          <path fill="currentColor" d="M6.7 9.2 4.4 4.1 8.9 6.7zM17.3 9.2 19.6 4.1 15.1 6.7z" />
          <circle cx="7.4" cy="11.3" r="2" fill="currentColor" />
          <circle cx="16.6" cy="11.3" r="2" fill="currentColor" />
          <circle cx="7.1" cy="15.2" r="1.8" fill="currentColor" />
          <circle cx="16.9" cy="15.2" r="1.8" fill="currentColor" />
          <circle cx="9.5" cy="17.7" r="1.65" fill="currentColor" />
          <circle cx="14.5" cy="17.7" r="1.65" fill="currentColor" />
          <circle cx="12" cy="8.7" r="1.85" fill="currentColor" />
          <path fill="currentColor" fillRule="evenodd" d="M12 13.15a4.35 4.35 0 1 0 0.01 0zM10.15 12.45a.75.75 0 1 0 .02 0zM13.7 12.45a.75.75 0 1 0 .02 0z" />
        </svg>
      );
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

function Face({ address, choice, size }: { address: string; choice: AvatarChoice; size?: number }) {
  const face = faceFor(choice);
  const style = {
    background: `linear-gradient(${face.angle}deg, ${face.from}, ${face.to})`,
    color: face.ink,
    ...(size ? { '--av': `${size}px` } : {}),
  } as CSSProperties;
  return (
    <span className={a.face} style={style} data-avatar={choice}>
      {choice === 'initials' ? <span className={a.letters}>{initials(address)}</span> : <Mark id={choice} />}
    </span>
  );
}

function useAvatarChoice(address: string): AvatarChoice {
  return useSyncExternalStore(subscribeAvatar, () => loadAvatarChoice(address), () => 'initials');
}

/** Circular wallet mark. Preset, or the address initials when unset. */
export function WalletAvatar({
  address, size = 40, label, title, decorative = false,
}: {
  address: string;
  size?: number;
  /** Accessible name when this circle is the wallet button. */
  label?: string;
  /** Hover text, usually the full address. */
  title?: string;
  decorative?: boolean;
}) {
  const choice = useAvatarChoice(address);
  return (
    <span className={a.hit} title={decorative ? undefined : title} aria-label={decorative ? undefined : label} aria-hidden={decorative ? true : undefined} role={decorative || !label ? undefined : 'img'}>
      <Face address={address} choice={choice} size={size} />
    </span>
  );
}

/** Address chip used by the text-style wallet buttons (mobile header, wrong network). */
export function WalletChip({ address, miniPay = false }: { address: string; miniPay?: boolean }) {
  return (
    <span className={a.chip}>
      <WalletAvatar address={address} size={28} decorative />
      <span className={`small ${a.chipText}`}>
        {miniPay ? 'MiniPay · ' : ''}
        {shorten(address)}
        {miniPay ? '' : ' ▾'}
      </span>
    </span>
  );
}

/** Preset grid shown inside the wallet menu. */
export function AvatarPicker({ address }: { address: string }) {
  const choice = useAvatarChoice(address);
  return (
    <div className={a.picker}>
      <p className={a.kicker}>Choose your avatar</p>
      <div className={a.grid} role="group" aria-label="Choose your avatar">
        {AVATAR_PRESETS.map((preset) => {
          const selected = choice === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              className={`${a.opt} ${selected ? a.on : ''}`}
              aria-pressed={selected}
              aria-label={preset.label}
              onClick={() => saveAvatarChoice(address, preset.id)}
            >
              <Face address={address} choice={preset.id} />
            </button>
          );
        })}
        <button
          type="button"
          className={`${a.opt} ${choice === 'initials' ? a.on : ''}`}
          aria-pressed={choice === 'initials'}
          aria-label="Initials"
          onClick={() => saveAvatarChoice(address, 'initials')}
        >
          <Face address={address} choice="initials" />
        </button>
      </div>
    </div>
  );
}
