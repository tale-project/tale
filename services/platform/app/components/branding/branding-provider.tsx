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
import { deriveAccentPalette } from '@/lib/utils/color';

interface BrandingState {
  appName?: string;
  logoUrl?: string | null;
  faviconLightUrl?: string | null;
  faviconDarkUrl?: string | null;
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

// The single accent color (#1960 — it superseded the old two-field
// brand/accent contract) drives the whole "primary action" palette in BOTH
// shipped token vocabularies (see packages/ui/src/globals.css header): the
// legacy HSL `--primary*` / `--ring` (badges, chat cards, focus rings) AND the
// canonical `@tale/ui` `--color-accent-base`/`--color-accent-fg` that the
// primary `Button` variant actually consumes (`bg-accent-base text-accent-fg`).
const CSS_OVERRIDES = [
  'primary',
  'primary-foreground',
  'primary-muted',
  'ring',
  'color-accent-base',
  'color-accent-fg',
] as const;

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
      accentColor: data.accentColor,
      isLoaded: true,
    };
  }, [data]);

  // One color is picked once but applied to both themes; derive the full
  // legible palette (base, ink, muted shade) for the active theme so even a
  // "bad" pick is normalized into contrast (the other theme derives its own).
  const palette = useMemo(
    () =>
      branding?.accentColor
        ? deriveAccentPalette(branding.accentColor, resolvedTheme)
        : undefined,
    [branding?.accentColor, resolvedTheme],
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

  // CSS variable injection for the derived accent palette (theme-adjusted).
  useEffect(() => {
    const root = document.documentElement;

    if (palette) {
      // Legacy HSL vocabulary: primary surface + matched ink + a muted shade,
      // and the focus ring, which globals.css keys to the same intent color.
      root.style.setProperty('--primary', palette.baseHsl);
      root.style.setProperty('--primary-foreground', palette.fgHsl);
      root.style.setProperty('--primary-muted', palette.mutedHsl);
      root.style.setProperty('--ring', palette.baseHsl);
      // Canonical `@tale/ui` vocabulary (raw hex): what the primary `Button`
      // reads via `bg-accent-base` / `text-accent-fg`.
      root.style.setProperty('--color-accent-base', palette.base);
      root.style.setProperty('--color-accent-fg', palette.fg);
    }

    return () => {
      for (const prop of CSS_OVERRIDES) {
        root.style.removeProperty(`--${prop}`);
      }
    };
  }, [palette]);

  // Expose the theme-adjusted accent as the context `accentColor` so every
  // consumer (sidebar, tabs, mobile nav) gets the legible variant.
  const value = useMemo<BrandingContextValue>(
    () => ({
      ...(branding ?? { isLoaded: false }),
      accentColor: palette?.base,
      refetch: async () => {
        await refetch();
      },
    }),
    [branding, palette, refetch],
  );

  return (
    <BrandingContext.Provider value={value}>
      {children}
    </BrandingContext.Provider>
  );
}
