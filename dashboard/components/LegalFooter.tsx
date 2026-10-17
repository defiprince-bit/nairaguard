import Link from 'next/link';
import s from './LegalFooter.module.css';

/** Support link target (WhatsApp, Telegram, email or a help page). The Support link is hidden when unset. */
export const SUPPORT_URL = process.env.NEXT_PUBLIC_SUPPORT_URL ?? '';

/** Fill in when the publisher is confirmed (MiniPay listing.md items 10–12). Keep the placeholder until then. */
export const PUBLISHER_NAME = '[PUBLISHER NAME]';

/**
 * Terms · Privacy · Support links + "Operated by" line.
 * variant 'page': below the content on mobile (MiniPay); hidden ≥1000px where the sidebar shows it.
 * variant 'side': pinned to the bottom of the desktop sidebar.
 * variant 'always': shown at every width (legal pages, connect screen).
 */
export function LegalFooter({ variant = 'page', className = '' }: { variant?: 'page' | 'side' | 'always'; className?: string }) {
  const support = SUPPORT_URL.trim();
  const mail = support.startsWith('mailto:');
  return (
    <footer className={`${s.foot} ${s[variant]} ${className}`} aria-label="Legal and support">
      <nav className={s.links} aria-label="Legal">
        <Link href="/terms">Terms</Link>
        <Link href="/privacy">Privacy</Link>
        {support ? (
          <a href={support} {...(mail ? {} : { target: '_blank', rel: 'noopener noreferrer' })}>Support</a>
        ) : null}
      </nav>
      <p className={s.op}>Operated by {PUBLISHER_NAME}. Not affiliated with MiniPay or Opera.</p>
    </footer>
  );
}
