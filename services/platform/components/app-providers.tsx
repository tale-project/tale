'use client';

import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';
import { ConvexClientProvider } from '@/components/convex-auth-provider';
import { ReactQueryProvider } from '@/components/react-query-provider';

interface AppProvidersProps {
  children: React.ReactNode;
  locale: string;
  messages: AbstractIntlMessages;
}

export function AppProviders({ children, locale, messages }: AppProvidersProps) {
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ConvexClientProvider>
        <ReactQueryProvider>{children}</ReactQueryProvider>
      </ConvexClientProvider>
    </NextIntlClientProvider>
  );
}
