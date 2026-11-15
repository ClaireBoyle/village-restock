import type { Metadata, Viewport } from 'next';
import { DM_Sans, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import './restock.css';
import { ServiceWorker } from '@/components/ServiceWorker';

// Fonts are bundled with the app at build time, so they also work offline.
const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-dm-sans', display: 'swap' });
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], weight: ['600', '700', '800'], variable: '--font-jakarta', display: 'swap' });

export const metadata: Metadata = {
  title: 'Village Restock',
  description: 'Guided restocking for cinema staff.',
  applicationName: 'Village Restock',
  appleWebApp: { capable: true, title: 'Restock', statusBarStyle: 'default' },
  robots: { index: false, follow: false },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F7F8FB' },
    { media: '(prefers-color-scheme: dark)', color: '#0D1222' },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-AU" className={`${dmSans.variable} ${jakarta.variable}`}>
      <body>{children}<ServiceWorker /></body>
    </html>
  );
}
