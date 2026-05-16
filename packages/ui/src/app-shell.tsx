'use client';

import type { i18n as I18nInstance } from 'i18next';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';

import { LocaleProvider, useLocale } from './i18n/locale-provider';
import { LocaleSync } from './i18n/sync';
import { type Theme, ThemeProvider } from './theme';

interface ClientLocaleConfig {
  /**
   * Use client-side detection: `<LocaleProvider>` reads localStorage →
   * `window.__ACCEPT_LANGUAGE__` → `navigator.languages` and exposes
   * `useLocale()` for the language picker. URL-driven services (web, docs)
   * omit `locale` entirely and mount `<LocaleSync>` from the root route
   * with `useCurrentLocale()`.
   */
  mode: 'client';
  /**
   * Side-effect fired on mount with the detected locale and after every
   * `setLocale()`. Platform passes `loadDayjsLocale` here so the matching
   * dayjs locale is fetched lazily without each consumer having its own
   * effect. Errors are not caught — the callback owns its failure modes.
   */
  onChange?: (locale: string) => void | Promise<void>;
  /** Falls back to the package default ('en-US') if omitted. */
  defaultLocale?: string;
}

interface ThemeConfig {
  /** Forwarded to `<ThemeProvider>`. Defaults to `'system'` when omitted. */
  defaultTheme?: Theme;
}

interface AppShellProps {
  /** The service's i18n instance, returned from `initServiceI18n`. */
  i18n: I18nInstance;
  /**
   * Locale source. Provide `{ mode: 'client', ... }` for services that drive
   * locale from a saved preference (platform, scaffolded services). Omit for
   * URL-driven services (web, docs) — those mount `<LocaleSync>` from their
   * own root route with the value read from the URL.
   */
  locale?: ClientLocaleConfig;
  /**
   * When provided, wraps the tree with `<ThemeProvider>` from
   * `@tale/ui/theme`. Omit for services pinned to a single theme that
   * intentionally don't toggle the `.dark` class on `<html>` (currently the
   * marketing site).
   */
  theme?: ThemeConfig;
  children: ReactNode;
}

function ClientLocaleBridge() {
  const { locale } = useLocale();
  return <LocaleSync locale={locale} />;
}

/**
 * Standardized provider shell every Tale frontend service uses. Owns the
 * cross-cutting theme + locale + i18n stack in the order that matters:
 *
 *   `<ThemeProvider>` → `<LocaleProvider>` → `<I18nextProvider>`
 *     → `<LocaleSync>` → children
 *
 * The ordering inside the i18n+locale block is load-bearing:
 * `<I18nextProvider>` contains a bridge that reads `useLocale()`, so
 * `<LocaleProvider>` must sit above it. Bundling the providers prevents
 * services from reinventing the bridge — every service used to ship a
 * per-service `lib/i18n/i18n-provider.tsx` doing exactly this.
 *
 * Query client, auth, branding, and router providers are not bundled
 * because they vary per service. Compose them around `<AppShell>`:
 *
 *   ```tsx
 *   <AppShell
 *     i18n={i18n}
 *     locale={{ mode: 'client', onChange: loadDayjsLocale }}
 *     theme={{ defaultTheme: 'system' }}
 *   >
 *     <RouterProvider router={router} />
 *   </AppShell>
 *   ```
 *
 * Services with extra outer providers (Convex auth, site-URL context, …)
 * wrap them above `<AppShell>`; extra inner providers (query client,
 * dialog providers, …) nest between `<AppShell>` and `<RouterProvider>`.
 */
export function AppShell({ i18n, locale, theme, children }: AppShellProps) {
  let tree: ReactNode = (
    <I18nextProvider i18n={i18n}>
      {locale ? <ClientLocaleBridge /> : null}
      {children}
    </I18nextProvider>
  );

  if (locale) {
    tree = (
      <LocaleProvider
        defaultLocale={locale.defaultLocale}
        onLocaleChange={locale.onChange}
      >
        {tree}
      </LocaleProvider>
    );
  }

  if (theme) {
    tree = (
      <ThemeProvider defaultTheme={theme.defaultTheme}>{tree}</ThemeProvider>
    );
  }

  return tree;
}
