'use client';

import { useTheme } from '@tale/ui/theme';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';

import { useBranding } from '@/app/features/settings/branding/hooks/queries';
import { useActiveOrganizationId } from '@/app/lib/active-organization';
import { setTitleSuffix } from '@/app/lib/title-suffix';
import { adjustColorForTheme, hexToHsl, isLightColor } from '@/lib/utils/color';

interface BrandingState {
  appName?: string;
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

const CSS_OVERRIDES = ['primary', 'primary-foreground'] as const;

export function BrandingProvider({ children }: BrandingProviderProps) {
  // Theme to the dashboard's active org (set by the dashboard layout). Outside
  // the dashboard this is `undefined`, so branding falls back to the platform
  // default — keeping the login/shell branding intact.
  const activeOrganizationId = useActiveOrganizationId();
  const { data, refetch } = useBranding(activeOrganizationId);
  const { resolvedTheme } = useTheme();

  const branding = useMemo<BrandingState | undefined>(() => {
    if (!data) return undefined;
    return {
      appName: data.appName,
      logoUrl: data.logoUrl,
      faviconLightUrl: data.faviconLightUrl,
      faviconDarkUrl: data.faviconDarkUrl,
      brandColor: data.brandColor,
      accentColor: data.accentColor,
      isLoaded: true,
    };
  }, [data]);

  // A color is picked once but applied to both themes; adapt each for the
  // active theme so a brand/accent that's illegible against this theme's
  // background is nudged into contrast (the other theme keeps the original).
  const adjustedColors = useMemo(
    () => ({
      brandColor: branding?.brandColor
        ? adjustColorForTheme(branding.brandColor, resolvedTheme)
        : undefined,
      accentColor: branding?.accentColor
        ? adjustColorForTheme(branding.accentColor, resolvedTheme)
        : undefined,
    }),
    [branding?.brandColor, branding?.accentColor, resolvedTheme],
  );

  const originalFaviconHrefRef = useRef<string | null>(null);

  // App title suffix: publish the org name to the title-suffix cache so the
  // route `head`/`seo()` composes "<page> - <org>" at head time. On a hard
  // reload the cache is seeded synchronously from localStorage, so the correct
  // suffix already renders on first paint; here we only handle the first time
  // an org name becomes known (or changes). Sign-out clears the cache so the
  // logged-out shell falls back to "Tale".
  useEffect(() => {
    const customName = branding?.appName;
    if (!customName) return;
    if (setTitleSuffix(customName)) {
      // The head for the current match already ran with the previous suffix
      // (e.g. the "Tale" fallback on a first-ever login). Re-run heads so the
      // live document title picks up the org name now that it is known.
      // Dynamic import keeps `@/app/router` (and its env + routeTree deps) off
      // the module graph for unit tests that only pull in branding consumers.
      void import('@/app/router').then(({ router }) => {
        void router.invalidate();
      });
    }
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

    if (!lightUrl && !darkUrl) return undefined;

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

  // CSS variable injection for the brand color (theme-adjusted)
  useEffect(() => {
    const root = document.documentElement;
    const brandColor = adjustedColors.brandColor;

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
  }, [adjustedColors.brandColor]);

  // Expose the theme-adjusted colors as the context `brandColor`/`accentColor`
  // so every consumer (sidebar, tabs, mobile nav) gets the legible variant.
  const value = useMemo<BrandingContextValue>(
    () => ({
      ...(branding ?? { isLoaded: false }),
      brandColor: adjustedColors.brandColor,
      accentColor: adjustedColors.accentColor,
      refetch: async () => {
        await refetch();
      },
    }),
    [branding, adjustedColors, refetch],
  );

  return (
    <BrandingContext.Provider value={value}>
      {children}
    </BrandingContext.Provider>
  );
}
