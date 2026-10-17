import type { Metadata } from 'next';
import { LegalPage } from '../../components/LegalPage';

/*
 * TEMPLATE — NOT LEGAL ADVICE. Have a qualified lawyer review this before you publish
 * (for example against Nigeria's Data Protection Act 2023 / NDPC rules and any other laws that apply to you).
 * Fill in every [PLACEHOLDER] in content/legal/privacy.md.
 * (Source: nairaguard-brand/docs/minipay/privacy.md. The banner is kept here, not on the page.)
 */

export const dynamic = 'force-static';
export const metadata: Metadata = { title: 'Privacy Policy · NairaGuard', alternates: { canonical: '/privacy' } };

export default function PrivacyPage() {
  return <LegalPage file="privacy.md" />;
}
