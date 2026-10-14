import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'NairaGuard',
  description: 'Stop losing money when the naira moves.',
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
