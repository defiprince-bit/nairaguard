import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'NairaGuard',
  description: 'Stop losing money when the naira moves.',
  metadataBase: new URL('https://nairaguard-vert.vercel.app'),
  openGraph: {
    title: 'NairaGuard',
    description: 'Stop losing money when the naira moves.',
    url: '/',
    siteName: 'NairaGuard',
    images: [{ url: '/og-banner.png', width: 1500, height: 500, alt: 'NairaGuard' }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'NairaGuard',
    description: 'Stop losing money when the naira moves.',
    images: ['/og-banner.png'],
  },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0E7A4F' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <style>{`@keyframes ng-skel{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
        {children}
      </body>
    </html>
  );
}
