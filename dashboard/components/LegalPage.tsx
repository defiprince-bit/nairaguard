import Link from 'next/link';
import { LegalFooter } from './LegalFooter';

export function LegalPage({ html }: { html: string }) {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '16px 16px 32px' }}>
      <p><Link href="/app" style={{ color: 'var(--brand)' }}>← Back to NairaGuard</Link></p>
      <article dangerouslySetInnerHTML={{ __html: html }} />
      <LegalFooter />
    </div>
  );
}
