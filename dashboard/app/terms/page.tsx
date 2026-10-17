import type { Metadata } from 'next';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LegalPage } from '../../components/LegalPage';
import { markdownToHtml } from '../../lib/markdown';

export const metadata: Metadata = { title: 'NairaGuard — Terms of Service' };
export const dynamic = 'force-static';

export default function Page() {
  const md = readFileSync(join(process.cwd(), 'content', 'terms.md'), 'utf8');
  return <LegalPage html={markdownToHtml(md)} />;
}
