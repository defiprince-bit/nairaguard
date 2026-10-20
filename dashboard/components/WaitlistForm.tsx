'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from './Button';
import { ErrorBanner } from './ErrorBanner';

const ALLOWED_SOURCES = new Set([
  'x',
  'celo-ng',
  'celo-africa-dao',
  'minipay',
  'whatsapp-freelancers',
  'referral',
]);

import { ConnectSheet } from './ConnectSheet';
import { getProvider, shorten, useWallet } from '../lib/wallet';

export function WaitlistForm() {
  const searchParams = useSearchParams();
  const source = useMemo(() => {
    const raw = searchParams.get('source') ?? '';
    return ALLOWED_SOURCES.has(raw) ? raw : 'direct';
  }, [searchParams]);

  const [contact, setContact] = useState('');
  const [consent, setConsent] = useState(false);
  const [wallet, setWallet] = useState('');
  const [isMiniPay, setIsMiniPay] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [signupToken, setSignupToken] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const connected = useWallet();
  // Outside MiniPay: a wallet connected through the sheet fills the (optional) wallet field.
  useEffect(() => {
    if (!isMiniPay && connected.address && !connected.miniPay) setWallet(connected.address);
  }, [connected.address, connected.miniPay, isMiniPay]);
  const [verifyState, setVerifyState] = useState<'idle' | 'signing' | 'verified' | 'skipped' | 'failed'>('idle');

  useEffect(() => {
    const eth = typeof window !== 'undefined' ? window.ethereum : undefined;
    if (!eth?.isMiniPay) return;
    setIsMiniPay(true);
    eth
      .request({ method: 'eth_requestAccounts' })
      .then((accounts) => {
        const list = accounts as string[];
        if (list?.[0]) setWallet(list[0]);
      })
      .catch(() => {
        /* leave wallet empty; wallet is optional */
      });
  }, []);

  const shareUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const u = new URL(window.location.href);
    u.search = '';
    if (source !== 'direct') u.searchParams.set('source', source);
    return u.toString();
  }, [source]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const email = contact.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Enter a valid email address.');
      return;
    }
    const w = wallet.trim();
    if (w && !/^0x[0-9a-fA-F]{40}$/.test(w)) {
      setError('That wallet address does not look right. It should be 0x followed by 40 characters.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/waitlist?source=${encodeURIComponent(source)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          contact: email, // older agent builds read `contact`
          consent,
          wallet: w || undefined,
          fromMiniPay: isMiniPay,
          source,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; signupToken?: string };
      if (!res.ok || !data.ok) {
        const msg: Record<string, string> = {
          consent_required: 'Please agree before joining.',
          email_required: 'Enter your email address.',
          email_invalid: 'Enter a valid email address.',
          wallet_invalid: 'That wallet address does not look right.',
          already_joined: 'You are already on the list.',
        };
        setError(msg[data.error ?? ''] ?? 'Something went wrong. Try again.');
        return;
      }
      setSignupToken(data.signupToken ?? null);
      setDone(true);
    } catch {
      setError('Network error. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  /** Optional step after joining: prove the MiniPay wallet is theirs (SIWE). Cancelling keeps them on the list, unverified. */
  async function verifyWallet() {
    const eth = getProvider();
    // Never run nonce/verify inside MiniPay.
    if (!eth || eth.isMiniPay || isMiniPay || !wallet || !signupToken) return;
    setVerifyState('signing');
    setVerifyCode(null);
    const fail = (code: string) => {
      setVerifyCode(code);
      setVerifyState('failed');
    };
    // 1) nonce
    let message: string | undefined;
    try {
      const n = await fetch(`/api/waitlist/nonce?address=${encodeURIComponent(wallet)}`, { cache: 'no-store' });
      const nd = (await n.json().catch(() => ({}))) as { message?: string; error?: string };
      message = nd.message;
      if (!n.ok || !message) return fail(`nonce_${nd.error ?? n.status}`);
    } catch {
      return fail('nonce_network');
    }
    // 2) sign (MiniPay may not support personal_sign; surface the provider code)
    // Try 0x-hex UTF-8 first (some wallets only accept that), then the plain string. Same bytes are signed either way.
    const hexMessage = `0x${Array.from(new TextEncoder().encode(message), (b) => b.toString(16).padStart(2, '0')).join('')}`;
    let signature: string | undefined;
    const errs: string[] = [];
    for (const [tag, payload] of [['hex', hexMessage], ['utf8', message]] as const) {
      try {
        signature = (await eth.request({ method: 'personal_sign', params: [payload, wallet] })) as string;
        break;
      } catch (e) {
        const err = e as { code?: number; name?: string; message?: string };
        if (err.code === 4001 || err.name === 'UserRejectedRequestError') {
          setVerifyState('skipped');
          return;
        }
        const unsupported = err.code === 4200 || err.code === -32601 || /not (currently )?supported|unsupported/i.test(err.message ?? '');
        errs.push(`${tag}:${unsupported ? 'unsupported_' : ''}${err.code ?? err.name ?? 'error'}`);
      }
    }
    if (!signature) return fail(`sign_${errs.join('|')}`);
    if (typeof signature !== 'string' || !signature.startsWith('0x')) return fail('sign_empty');
    // 3) verify
    try {
      const v = await fetch('/api/waitlist/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ signupToken, message, signature }),
      });
      const vd = (await v.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (v.ok && vd.ok) setVerifyState('verified');
      else fail(`verify_${vd.error ?? v.status}`);
    } catch {
      fail('verify_network');
    }
  }

  async function copyShare() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  if (done) {
    return (
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-card)',
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <h2 className="h2" style={{ margin: 0 }}>
          You&apos;re on the list
        </h2>
        {isMiniPay ? (
          <p className="small" role="status" style={{ margin: 0, color: 'var(--brand)', fontWeight: 600 }}>
            You&apos;re on the list ✓. We&apos;ll message you when deposits open.
          </p>
        ) : (
          <p className="small" style={{ margin: 0, color: 'var(--ink-muted)' }}>
            We&apos;ll ping you when NairaGuard opens inside MiniPay.
          </p>
        )}
        {/* Never show the wallet-confirm (nonce/verify) step inside MiniPay. */}
        {!isMiniPay && !connected.miniPay && wallet && connected.address?.toLowerCase() === wallet.toLowerCase() && signupToken && verifyState !== 'verified' ? (
          <div
            style={{
              padding: 14,
              borderRadius: 'var(--radius-btn)',
              background: 'var(--brand-soft)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <p className="small" style={{ margin: 0, color: 'var(--ink)' }}>
              Sign to confirm this wallet is yours. It&apos;s free and doesn&apos;t move any money.
            </p>
            <Button fullWidth onClick={verifyWallet} disabled={verifyState === 'signing'}>
              {verifyState === 'signing' ? 'Check your wallet…' : 'Confirm my wallet'}
            </Button>
            {verifyState === 'skipped' ? (
              <p className="small" style={{ margin: 0, color: 'var(--ink-muted)' }}>
                No problem, you&apos;re still on the list. You can confirm any time.
              </p>
            ) : null}
            {verifyState === 'failed' ? (
              <p className="small" style={{ margin: 0, color: 'var(--danger)' }}>
                Couldn&apos;t confirm right now. You&apos;re still on the list. Try again in a moment.
              </p>
            ) : null}
            {verifyState === 'failed' && verifyCode ? (
              <p className="small" style={{ margin: 0, fontSize: 11, color: 'var(--ink-muted)', fontFamily: 'monospace' }}>
                Error code: {verifyCode}
              </p>
            ) : null}
          </div>
        ) : null}
        {verifyState === 'verified' ? (
          <p className="small" role="status" style={{ margin: 0, color: 'var(--brand)', fontWeight: 600 }}>
            Wallet confirmed ✓
          </p>
        ) : null}
        <Button fullWidth onClick={copyShare}>
          {copied ? 'Link copied' : 'Copy share link'}
        </Button>
        <p className="small" style={{ margin: 0, color: 'var(--ink-muted)', wordBreak: 'break-all' }}>
          {shareUrl}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="small" style={{ fontWeight: 600 }}>
          Email
        </span>
        <input
          required
          type="email"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          placeholder="you@email.com"
          inputMode="email"
          autoComplete="email"
          style={{
            minHeight: 44,
            padding: '10px 12px',
            borderRadius: 'var(--radius-btn)',
            border: '1px solid var(--border)',
            background: 'var(--surface)',
          }}
        />
        <span className="small" style={{ color: 'var(--ink-muted)' }}>
          We&apos;ll only message you about early access.
        </span>
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="small" style={{ fontWeight: 600 }}>
          Wallet {isMiniPay ? '(from MiniPay)' : '(optional)'}
        </span>
        <input
          value={wallet}
          pattern="0x[0-9a-fA-F]{40}"
          title="0x followed by 40 hex characters"
          spellCheck={false}
          autoCapitalize="off"
          onChange={(e) => setWallet(e.target.value)}
          readOnly={isMiniPay}
          placeholder={isMiniPay ? 'Connecting MiniPay…' : '0x…'}
          style={{
            minHeight: 44,
            padding: '10px 12px',
            borderRadius: 'var(--radius-btn)',
            border: '1px solid var(--border)',
            background: isMiniPay ? 'var(--brand-soft)' : 'var(--surface)',
            color: 'var(--ink)',
          }}
        />
        {isMiniPay && wallet ? (
          <span className="small" style={{ color: 'var(--brand)' }}>
            MiniPay · {shorten(wallet)}
          </span>
        ) : null}
        {!isMiniPay ? (
          connected.address ? (
            <span className="small" style={{ color: 'var(--brand)' }}>
              {connected.label ?? 'Wallet'} · {shorten(connected.address)}
            </span>
          ) : (
            <Button variant="secondary" onClick={() => setSheet(true)} style={{ borderRadius: 999, alignSelf: 'flex-start' }}>
              Connect wallet
            </Button>
          )
        ) : null}
      </label>

      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          style={{ width: 20, height: 20, marginTop: 2 }}
          required
        />
        <span className="small" style={{ color: 'var(--ink-muted)' }}>
          I agree to be contacted about NairaGuard and understand this is a waitlist, not a deposit.
        </span>
      </label>

      {error ? <ErrorBanner message={error} onRetry={() => setError(null)} /> : null}

      <Button type="submit" fullWidth disabled={submitting || !consent}>
        {submitting ? 'Joining…' : 'Join the waitlist'}
      </Button>
      <p className="small" style={{ margin: 0, textAlign: 'center', color: 'var(--ink-muted)' }}>
        Works right inside MiniPay, or with Valora and MetaMask
      </p>
      {sheet && !isMiniPay ? <ConnectSheet onClose={() => setSheet(false)} /> : null}
    </form>
  );
}
