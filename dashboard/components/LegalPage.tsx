import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import { parseLegalMarkdown, type Inline } from '../lib/legalMarkdown';
import { LegalFooter } from './LegalFooter';
import { ThemeToggle } from './ThemeToggle';
import s from './LegalPage.module.css';

function renderInline(v: Inline[]): ReactNode {
  return v.map((x, i) => {
    switch (x.t) {
      case 'text': return <Fragment key={i}>{x.v}</Fragment>;
      case 'strong': return <strong key={i}>{renderInline(x.v)}</strong>;
      case 'code': return <code key={i}>{x.v}</code>;
      case 'link': return <a key={i} href={x.href} target="_blank" rel="noopener noreferrer">{x.v}</a>;
      case 'br': return <br key={i} />;
    }
  });
}

/** Server component: renders dashboard/content/legal/<file> at build time. */
export function LegalPage({ file }: { file: 'terms.md' | 'privacy.md' }) {
  const md = readFileSync(join(process.cwd(), 'content', 'legal', file), 'utf8');
  const blocks = parseLegalMarkdown(md);
  return (
    <div className={s.wrap}>
      <header className={s.top}>
        <Link href="/app" className={s.brand}><img src="/icon-v2.svg" alt="" />NairaGuard</Link>
        <span className={s.actions}>
          <ThemeToggle />
          <Link href="/app" className={s.back}>Back to app</Link>
        </span>
      </header>
      <article className={s.card}>
        {blocks.map((b, i) =>
          b.t === 'h1' ? <h1 key={i}>{renderInline(b.v)}</h1>
          : b.t === 'h2' ? <h2 key={i}>{renderInline(b.v)}</h2>
          : b.t === 'p' ? <p key={i}>{renderInline(b.v)}</p>
          : b.t === 'ul' ? <ul key={i}>{b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}</ul>
          : <hr key={i} />,
        )}
      </article>
      <LegalFooter variant="always" className={s.foot} />
    </div>
  );
}
