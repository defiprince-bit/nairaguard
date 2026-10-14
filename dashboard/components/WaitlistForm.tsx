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

type EthProvider = {
  isMiniPay?: boolean;
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

declare global {
  interface Window {
    ethereum?: EthProvider;
  }
}

function shorten(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function WaitlistForm({ lossNgn }: { lossNgn?: number }) {
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
        /* leave wallet empty; user can still join with contact */
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
    setSubmitting(true);
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contact: contact.trim(),
          consent,
          wallet: wallet || undefined,
          fromMiniPay: isMiniPay,
          source,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error === 'consent_required' ? 'Please agree before joining.' : 'Something went wrong. Try again.');
        return;
      }
      setDone(true);
    } catch {
      setError('Network error. Try again.');
    } finally {
      setSubmitting(false);
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
        <p className="small" style={{ margin: 0, color: 'var(--ink-muted)' }}>
          We&apos;ll ping you when NairaGuard opens inside MiniPay.
        </p>
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
      {lossNgn != null && Number.isFinite(lossNgn) ? (
        <div
          style={{
            background: 'var(--warn-soft)',
            border: '1px solid #f0d7a8',
            borderRadius: 'var(--radius-card)',
            padding: 16,
            color: 'var(--warn)',
          }}
        >
          <p style={{ margin: 0 }} className="tabular">
            ₦500,000 held in naira lost about ₦{lossNgn.toLocaleString('en-NG')} when the rate moved last
            month.
          </p>
        </div>
      ) : null}

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="small" style={{ fontWeight: 600 }}>
          Email or phone
        </span>
        <input
          required
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          placeholder="you@email.com or +234…"
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
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="small" style={{ fontWeight: 600 }}>
          Wallet {isMiniPay ? '(verified)' : '(optional)'}
        </span>
        <input
          value={wallet}
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
        Works right inside MiniPay
      </p>
    </form>
  );
}
