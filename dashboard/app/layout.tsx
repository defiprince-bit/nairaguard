import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'NairaGuard',
  description: 'Stop losing money when the naira moves.',
  metadataBase: new URL('https://nairaguard.space'),
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

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: [
  { media: '(prefers-color-scheme: dark)', color: '#05140e' },
  { media: '(prefers-color-scheme: light)', color: '#eef6f1' },
] };

const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('ng.theme');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='dark'}})()`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Set the theme before first paint so there is no flash of the wrong one. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <style>{`@keyframes ng-skel{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
        {children}
      </body>
    </html>
  );
}
