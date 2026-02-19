'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';

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

const DEFAULT_TITLE_SUFFIX = 'Tale';

export function BrandingProvider({
  organizationId,
  children,
}: BrandingProviderProps) {
  const { data: branding } = useConvexQuery(api.branding.queries.getBranding, {
    organizationId,
  });

  const originalFaviconHrefRef = useRef<string | null>(null);

  useEffect(() => {
    const customName = branding?.appName;
    const targetSuffix = customName || DEFAULT_TITLE_SUFFIX;

    const updateTitle = () => {
      const title = document.title;
      const updated = title.replace(/- [^-]+$/, `- ${targetSuffix}`);
      if (updated !== title) {
        document.title = updated;
      }
    };

    updateTitle();

    const observer = new MutationObserver(updateTitle);
    const titleElement = document.querySelector('title');
    if (titleElement) {
      observer.observe(titleElement, { childList: true });
    }

    return () => {
      observer.disconnect();
      if (customName) {
        const title = document.title;
        if (title.includes(`- ${customName}`)) {
          document.title = title.replace(
            `- ${customName}`,
            `- ${DEFAULT_TITLE_SUFFIX}`,
          );
        }
      }
    };
  }, [branding?.appName]);

  useEffect(() => {
    const link =
      document.querySelector<HTMLLinkElement>('link[rel="icon"]') ??
      document.createElement('link');
    link.rel = 'icon';

    if (originalFaviconHrefRef.current === null) {
      originalFaviconHrefRef.current = link.href;
    }

    const lightUrl = branding?.faviconLightUrl;
    const darkUrl = branding?.faviconDarkUrl;

    if (!lightUrl && !darkUrl) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const updateFavicon = () => {
      const url = mediaQuery.matches && darkUrl ? darkUrl : lightUrl;
      if (url) {
        link.href = url;
      }
    };

    updateFavicon();

    if (!link.parentNode) {
      document.head.appendChild(link);
    }

    mediaQuery.addEventListener('change', updateFavicon);

    return () => {
      mediaQuery.removeEventListener('change', updateFavicon);
      if (originalFaviconHrefRef.current) {
        link.href = originalFaviconHrefRef.current;
      }
    };
  }, [branding?.faviconLightUrl, branding?.faviconDarkUrl]);

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
