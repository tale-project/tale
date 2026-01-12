'use client';

import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';
import { ConvexClientProvider } from './convex-auth-provider';
import { ReactQueryProvider } from './react-query-provider';
import { SiteUrlProvider } from '@/lib/site-url-context';

interface AppProvidersProps {
  children: React.ReactNode;
  locale: string;
  messages: AbstractIntlMessages;
  siteUrl: string;
}

export function AppProviders({
  children,
  locale,
  messages,
  siteUrl,
}: AppProvidersProps) {
  const convexUrl = `${siteUrl.replace(/\/+$/, '')}/ws_api`;

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <SiteUrlProvider siteUrl={siteUrl}>
        <ConvexClientProvider convexUrl={convexUrl}>
          <ReactQueryProvider>{children}</ReactQueryProvider>
        </ConvexClientProvider>
      </SiteUrlProvider>
    </NextIntlClientProvider>
  );
}
