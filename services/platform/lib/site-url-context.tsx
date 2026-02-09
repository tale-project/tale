'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { getEnv } from '@/lib/env';

interface SiteUrlContextValue {
  siteUrl: string;
  convexUrl: string;
}

const SiteUrlContext = createContext<SiteUrlContextValue | null>(null);

interface SiteUrlProviderProps {
  children: ReactNode;
}

export function SiteUrlProvider({ children }: SiteUrlProviderProps) {
  const value = useMemo(() => {
    const siteUrl = getEnv('SITE_URL');
    return {
      siteUrl,
      convexUrl: `${siteUrl}/ws_api`,
    };
  }, []);

  return (
    <SiteUrlContext.Provider value={value}>{children}</SiteUrlContext.Provider>
  );
}

export function useSiteUrl(): string {
  const context = useContext(SiteUrlContext);
  if (!context) {
    throw new Error(
      'useSiteUrl must be used within a SiteUrlProvider. ' +
        'Ensure your component is wrapped in AppProviders.',
    );
  }
  return context.siteUrl;
}
