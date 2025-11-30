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

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
  ),
  title: 'Tale | Reduce Churn Rate & Boost Retention',
  description:
    'Use Tale to understand customer churn rate, improve retention, and increase customer lifetime value through feedback and analytics.',
  openGraph: {
    title: 'Tale | Reduce Churn Rate & Boost Retention',
    description:
      'Use Tale to understand customer churn rate, improve retention, and increase customer lifetime value through feedback and analytics.',
    url:
      process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'),
    type: 'website',
    images: [
      {
        url: `${process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')}/opengraph-image.png`,
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
