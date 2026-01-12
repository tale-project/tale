import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { getLocale, getMessages } from 'next-intl/server';
// eslint-disable-next-line import/no-unassigned-import
import './globals.css';
import { Toaster } from '@/components/ui/toaster';

import { ThemeProvider } from '@/components/theme-provider';
import { ThemeColorMeta } from '@/components/theme-color-meta';
import { AppProviders } from '@/providers/app-providers';
import { getT } from '@/lib/i18n/server';
import { getSiteUrl } from '@/lib/get-site-url';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
});

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fcfcfc' },
    { media: '(prefers-color-scheme: dark)', color: '#09090b' },
  ],
};

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('metadata');
  const appUrl = await getSiteUrl();

  return {
    metadataBase: new URL(appUrl),
    title: {
      default: `${t('default.title')} | ${t('suffix')}`,
      template: `%s | ${t('suffix')}`,
    },
    description: t('default.description'),
    keywords: t('keywords'),
    authors: [{ name: 'Tale', url: 'https://tale.dev' }],
    creator: 'Tale',
    publisher: 'Tale',
    formatDetection: {
      email: false,
      address: false,
      telephone: false,
    },
    openGraph: {
      title: t('default.title'),
      description: t('default.description'),
      url: appUrl,
      siteName: t('suffix'),
      locale: 'en_US',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: t('default.title'),
      description: t('default.description'),
    },
    icons: {
      icon: '/favicon.ico',
    },
    manifest: '/manifest.webmanifest',
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const locale = await getLocale();
  const messages = await getMessages();
  const siteUrl = await getSiteUrl();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`${inter.variable} antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <ThemeColorMeta />
          <AppProviders locale={locale} messages={messages} siteUrl={siteUrl}>
            {children}
          </AppProviders>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
