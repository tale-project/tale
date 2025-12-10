import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import localFont from 'next/font/local';
import { Analytics } from '@vercel/analytics/react';
import './globals.css';
import { Toaster } from '@/components/ui/toaster';

import { ThemeProvider } from '@/components/theme-provider';
import { AppProviders } from '@/components/app-providers';


const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
});

const metroSans = localFont({
  src: [
    {
      path: './metro-sans-variable-regular.woff2',
      style: 'normal',
      weight: '100 900',
    },
    {
      path: './metro-sans-variable-regular.woff',
      style: 'normal',
      weight: '100 900',
    },
    {
      path: './metro-sans-variable-regular.ttf',
      style: 'normal',
      weight: '100 900',
    },
  ],
  variable: '--font-metro-sans',
  display: 'swap',
});

// Derive app URL from SITE_URL (server-side) or fallback for Vercel/local dev
const appUrl =
  process.env.SITE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: 'Tale | Reduce Churn Rate & Boost Retention',
  description:
    'Use Tale to understand customer churn rate, improve retention, and increase customer lifetime value through feedback and analytics.',
  openGraph: {
    title: 'Tale | Reduce Churn Rate & Boost Retention',
    description:
      'Use Tale to understand customer churn rate, improve retention, and increase customer lifetime value through feedback and analytics.',
    url: appUrl,
    type: 'website',
    images: [
      {
        url: `${appUrl}/opengraph-image.png`,
      },
    ],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${metroSans.variable} antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <AppProviders>{children}</AppProviders>
          <Toaster />
          <Analytics />
        </ThemeProvider>
      </body>
    </html>
  );
}
