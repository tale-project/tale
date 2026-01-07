'use client';

import { createContext, useContext, type ReactNode } from 'react';

interface SiteUrlContextValue {
  siteUrl: string;
  convexUrl: string;
}

const SiteUrlContext = createContext<SiteUrlContextValue | null>(null);

interface SiteUrlProviderProps {
  children: ReactNode;
  siteUrl: string;
}

export function SiteUrlProvider({ children, siteUrl }: SiteUrlProviderProps) {
  const value: SiteUrlContextValue = {
    siteUrl: siteUrl.replace(/\/+$/, ''),
    convexUrl: `${siteUrl.replace(/\/+$/, '')}/ws_api`,
  };

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

export function useConvexUrl(): string {
  const context = useContext(SiteUrlContext);
  if (!context) {
    throw new Error(
      'useConvexUrl must be used within a SiteUrlProvider. ' +
        'Ensure your component is wrapped in AppProviders.',
    );
  }
  return context.convexUrl;
}

