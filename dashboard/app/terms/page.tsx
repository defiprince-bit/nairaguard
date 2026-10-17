import type { Metadata } from 'next';
import { LegalPage } from '../../components/LegalPage';

/*
 * TEMPLATE — NOT LEGAL ADVICE. Have a qualified lawyer review this before you publish.
 * Fill in every [PLACEHOLDER] in content/legal/terms.md. Last reviewed by counsel: [DATE].
 * (Source: nairaguard-brand/docs/minipay/terms.md. The banner is kept here, not on the page.)
 */

export const dynamic = 'force-static';
export const metadata: Metadata = { title: 'Terms of Service · NairaGuard', alternates: { canonical: '/terms' } };

export default function TermsPage() {
  return <LegalPage file="terms.md" />;
}
