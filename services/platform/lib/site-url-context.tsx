'use client';

import { createContext, useContext } from 'react';

interface SiteUrlContextValue {
  siteUrl: string;
  convexUrl: string;
}

const SiteUrlContext = createContext<SiteUrlContextValue | null>(null);

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

