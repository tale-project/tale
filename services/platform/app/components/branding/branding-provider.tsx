'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';

import { useBranding } from '@/app/features/settings/branding/hooks/queries';
import { hexToHsl, isLightColor } from '@/lib/utils/color';

interface BrandingState {
  appName?: string;
  textLogo?: string;
  logoUrl?: string | null;
  faviconLightUrl?: string | null;
  faviconDarkUrl?: string | null;
  brandColor?: string;
  accentColor?: string;
  isLoaded: boolean;
}

interface BrandingContextValue extends BrandingState {
  refetch: () => Promise<void>;
}

const noop = async () => {};

const BrandingContext = createContext<BrandingContextValue>({
  isLoaded: false,
  refetch: noop,
});

export function useBrandingContext() {
  return useContext(BrandingContext);
}

interface BrandingProviderProps {
  children: ReactNode;
}

const DEFAULT_TITLE_SUFFIX = 'Tale';

const CSS_OVERRIDES = ['primary', 'primary-foreground'] as const;

export function BrandingProvider({ children }: BrandingProviderProps) {
  const { data, refetch } = useBranding();

  const branding = useMemo<BrandingState | undefined>(() => {
    if (!data) return undefined;
    return {
      appName: data.appName,
      textLogo: data.textLogo,
      logoUrl: data.logoUrl,
      faviconLightUrl: data.faviconLightUrl,
      faviconDarkUrl: data.faviconDarkUrl,
      brandColor: data.brandColor,
      accentColor: data.accentColor,
      isLoaded: true,
    };
  }, [data]);

  const originalFaviconHrefRef = useRef<string | null>(null);

  // App title override
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

  // Favicon override
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

  // CSS variable injection for brand/accent colors
  useEffect(() => {
    const root = document.documentElement;
    const brandColor = branding?.brandColor;

    if (brandColor) {
      root.style.setProperty('--primary', hexToHsl(brandColor));
      root.style.setProperty(
        '--primary-foreground',
        isLightColor(brandColor) ? '0 0% 3.9%' : '0 0% 98%',
      );
    }

    return () => {
      for (const prop of CSS_OVERRIDES) {
        root.style.removeProperty(`--${prop}`);
      }
    };
  }, [branding?.brandColor]);

  const value = useMemo<BrandingContextValue>(
    () => ({
      ...(branding ?? { isLoaded: false }),
      refetch: async () => {
        await refetch();
      },
    }),
    [branding, refetch],
  );

  return (
    <BrandingContext.Provider value={value}>
      {children}
    </BrandingContext.Provider>
  );
}
