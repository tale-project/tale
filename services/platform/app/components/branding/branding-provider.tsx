'use client';

import { createContext, useContext, useEffect, type ReactNode } from 'react';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

interface BrandingContextValue {
  appName?: string;
  textLogo?: string;
  logoUrl?: string | null;
  faviconLightUrl?: string | null;
  faviconDarkUrl?: string | null;
  brandColor?: string;
  accentColor?: string;
  isLoaded: boolean;
}

const BrandingContext = createContext<BrandingContextValue>({
  isLoaded: false,
});

export function useBrandingContext() {
  return useContext(BrandingContext);
}

interface BrandingProviderProps {
  organizationId: string;
  children: ReactNode;
}

export function BrandingProvider({
  organizationId,
  children,
}: BrandingProviderProps) {
  const { data: branding } = useConvexQuery(api.branding.queries.getBranding, {
    organizationId,
  });

  // Update document title suffix when app name changes
  useEffect(() => {
    if (!branding?.appName) return;

    const originalSuffix = 'Tale';
    const updateTitle = () => {
      const title = document.title;
      if (title.endsWith(`- ${originalSuffix}`)) {
        document.title = title.replace(
          `- ${originalSuffix}`,
          `- ${branding.appName}`,
        );
      }
    };

    updateTitle();

    const observer = new MutationObserver(updateTitle);
    const titleElement = document.querySelector('title');
    if (titleElement) {
      observer.observe(titleElement, { childList: true });
    }

    return () => observer.disconnect();
  }, [branding?.appName]);

  // Update favicon when branding changes
  useEffect(() => {
    const faviconUrl = branding?.faviconLightUrl;
    if (!faviconUrl) return;

    const link =
      document.querySelector<HTMLLinkElement>('link[rel="icon"]') ??
      document.createElement('link');
    link.rel = 'icon';

    const originalHref = link.href;
    link.href = faviconUrl;

    if (!link.parentNode) {
      document.head.appendChild(link);
    }

    return () => {
      link.href = originalHref;
    };
  }, [branding?.faviconLightUrl]);

  const value: BrandingContextValue = {
    appName: branding?.appName,
    textLogo: branding?.textLogo,
    logoUrl: branding?.logoUrl,
    faviconLightUrl: branding?.faviconLightUrl,
    faviconDarkUrl: branding?.faviconDarkUrl,
    brandColor: branding?.brandColor,
    accentColor: branding?.accentColor,
    isLoaded: branding !== undefined,
  };

  return (
    <BrandingContext.Provider value={value}>
      {children}
    </BrandingContext.Provider>
  );
}
