import Link from 'next/link';
import { PUBLISHER_NAME, SUPPORT_URL } from '../lib/legal';
import s from './LegalFooter.module.css';

const link = { color: 'var(--brand)' } as const;

/** Terms · Privacy · Support (hidden until SUPPORT_URL is set), plus who runs the service. */
export function LegalFooter() {
  return (
    <footer className={`small ${s.foot}`} style={{ textAlign: 'center', color: 'var(--ink-muted)', padding: '16px 16px 8px' }}>
      <nav aria-label="Legal" style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
        <Link href="/terms" style={link}>Terms</Link>
        <Link href="/privacy" style={link}>Privacy</Link>
        {SUPPORT_URL ? <a href={SUPPORT_URL} target="_blank" rel="noopener noreferrer" style={link}>Support</a> : null}
      </nav>
      <p style={{ margin: '8px 0 0' }}>Operated by {PUBLISHER_NAME}. Not affiliated with MiniPay or Opera.</p>
    </footer>
  );
}
