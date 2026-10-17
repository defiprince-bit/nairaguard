import Link from 'next/link';
import { LegalFooter } from './LegalFooter';
import s from './LegalPage.module.css';

export function LegalPage({ html }: { html: string }) {
  return (
    <div className={s.wrap} style={{ maxWidth: 720, margin: '0 auto', padding: '16px 16px 32px' }}>
      <p><Link href="/app" className={s.back} style={{ color: 'var(--brand)' }}>← Back to NairaGuard</Link></p>
      <article className={s.doc} dangerouslySetInnerHTML={{ __html: html }} />
      <LegalFooter />
    </div>
  );
}
