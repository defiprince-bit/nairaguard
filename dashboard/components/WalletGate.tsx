'use client';

import { ThemeToggle } from './ThemeToggle';
import { Fragment, ReactNode, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from './Button';
import { ErrorBanner } from './ErrorBanner';
import { Skeleton } from './Skeleton';
import { ConnectSheet } from './ConnectSheet';
import g from './ConnectGate.module.css';
import { SwitchNetworkBar, WalletMenu } from './WalletMenu';
import { CHAIN_NAME, shorten, switchToAppChain, useWallet } from '../lib/wallet';

export function WalletGate({ children, bare }: { children: (address: string, miniPay: boolean) => ReactNode; /** Skip the default header (screens with their own top bar). */ bare?: boolean }) {
  const { address, miniPay, booting, connecting, error, connect, setError, wrongChain } = useWallet();
  const pathname = usePathname();
  const router = useRouter();
  // ?connect=1 opens the sheet straight away (outreach links, demo recording).
  const [sheet, setSheet] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('connect') === '1') setSheet(true);
  }, []);

  // After disconnect (menu or wallet-side), land on Overview — not /app/limits etc.
  useEffect(() => {
    if (booting || miniPay || address) return;
    if (pathname && pathname.startsWith('/app/') && pathname !== '/app') {
      router.replace('/app');
    }
  }, [address, booting, miniPay, pathname, router]);

  const [switching, setSwitching] = useState(false);
  const [switchErr, setSwitchErr] = useState<string | null>(null);

  async function doSwitch() {
    setSwitching(true);
    setSwitchErr(null);
    try { await switchToAppChain(); } catch { setSwitchErr(`Couldn’t switch. Open your wallet and pick ${CHAIN_NAME}.`); }
    finally { setSwitching(false); }
  }

  if ((connecting || booting) && !address) {
    return (
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Skeleton height={24} width="40%" />
        <Skeleton height={120} />
        <Skeleton height={80} />
      </div>
    );
  }

  if (!address) {
    return (
      <div className={g.screen}>
        <ThemeToggle className={g.toggle} />
        <header className={`${g.topbar} ${g.desk}`}>
          <img src="/logo-v2.svg" alt="" width={40} height={40} />
          <span>NairaGuard</span>
        </header>
        <div className={g.layout}>
        <section className={`${g.hero} ${g.desk}`}>
          <h1 className={g.headline}>Your savings, <em>guarded</em> against naira swings.</h1>
          <p className={g.lede}>Your savings, balanced between naira and dollars at the mix you choose. Your own vault, and only you can withdraw.</p>
          <ul className={g.feats}>
            <li className={g.feat}><b>24/7</b><span>Agent watches the rate</span></li>
            <li className={g.feat}><b>You</b><span>Own the vault, withdraw anytime</span></li>
            <li className={g.feat}><b>3%</b><span>Max slippage vs Chainlink</span></li>
          </ul>
        </section>
        <div className={g.card}>
          <img src="/icon-v2.svg" alt="" width={68} height={68} className={g.icon} />
          <h1 className={`${g.title} ${g.mob}`}>Connect your wallet</h1>
          <h2 className={`${g.title} ${g.desk}`}>Connect your wallet</h2>
          <p className={g.sub}>
            {miniPay
              ? 'MiniPay is ready. Tap below if your wallet did not connect automatically.'
              : 'Connect Valora, MetaMask or another Celo wallet. On your phone, MiniPay is the quickest way in.'}
          </p>
          {error ? <ErrorBanner message={error} onRetry={() => setError(null)} /> : null}
          {!miniPay ? (
            <Button fullWidth className={g.cta} onClick={() => setSheet(true)}>Connect wallet</Button>
          ) : (
            <Button fullWidth className={g.cta} onClick={connect} disabled={connecting}>
              {connecting ? 'Connecting…' : 'Retry MiniPay connect'}
            </Button>
          )}
          {!miniPay ? (
            <div className={`${g.mp} ${g.desk}`}>
              <img src="/minipay-logo.png" alt="MiniPay" width={40} height={40} />
              <p>On your phone? Open in <strong>MiniPay</strong>, the quickest way in.</p>
            </div>
          ) : null}
          <p className={g.note}>Your own vault · withdraw anytime</p>
        </div>
        </div>
        {sheet && !miniPay ? <ConnectSheet onClose={() => setSheet(false)} /> : null}
      </div>
    );
  }

  if (wrongChain) {
    return (
      <div style={{ padding: '24px 16px' }}>
        <SwitchNetworkBar onSwitch={doSwitch} busy={switching} chainName={CHAIN_NAME} />
        {switchErr ? <p className="small" style={{ maxWidth: 520, margin: '8px auto', color: 'var(--danger)' }}>{switchErr}</p> : null}
        <div style={{ maxWidth: 520, margin: '12px auto', display: 'flex', justifyContent: 'flex-end' }}>
          <WalletMenu trigger={<span className="small" style={{ color: 'var(--ink-muted)' }}>{shorten(address)} ▾</span>} />
        </div>
      </div>
    );
  }

  if (bare) return <Fragment key={address}>{children(address, miniPay)}</Fragment>;

  return (
    <div style={{ paddingBottom: 72 }}>
      <header
        style={{
          maxWidth: 480,
          margin: '0 auto',
          padding: '12px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <img src="/logo-v2.svg" alt="" width={28} height={28} style={{ borderRadius: 8 }} />
          <strong style={{ color: 'var(--brand)' }}>NairaGuard</strong>
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <ThemeToggle />
        <WalletMenu
          trigger={
            <span className="small" style={{ color: 'var(--ink-muted)' }}>
              {miniPay ? 'MiniPay · ' : ''}
              {shorten(address)}
              {miniPay ? '' : ' ▾'}
            </span>
          }
        />
        </span>
      </header>
      <Fragment key={address}>{children(address, miniPay)}</Fragment>
    </div>
  );
}
