import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { RegisterSW } from '@/components/pwa/RegisterSW';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Garmin Coach',
  description: 'AI Fitness Coach — Mankato Marathon 2026',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Coach',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0f0f0f',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <RegisterSW />
        {children}
      </body>
    </html>
  );
}
