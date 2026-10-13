'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { detectPreferredLocale, LOCALE_STORAGE_KEY } from './detect-locale';
import { isValidLocale } from './is-valid-locale';

interface LocaleContextValue {
  locale: string;
  setLocale: (newLocale: string) => void;
}

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

interface LocaleProviderProps {
  children: ReactNode;
  defaultLocale?: string;
  /**
   * Optional side-effect run on mount with the detected locale and after every
   * `setLocale()` call. Use it to load locale-tied resources — platform passes
   * `loadDayjsLocale` so the matching dayjs locale is fetched lazily. Errors
   * are not caught: callers should handle their own failure modes.
   */
  onLocaleChange?: (locale: string) => void | Promise<void>;
}

/**
 * Owns the user's preferred locale for services that drive locale from a
 * client-side preference rather than the URL: detects it on mount
 * (localStorage → server-rendered `window.__ACCEPT_LANGUAGE__` → browser
 * languages), persists changes to localStorage, and exposes a `useLocale()`
 * hook for consumers (language picker, date formatter, etc.).
 *
 * Mount ABOVE `<I18nextProvider>` so the locale-sync bridge — usually a small
 * `<LocaleSync>` wrapper that reads `useLocale()` — sees the same context as
 * the language picker. Without that shared context the picker only updates
 * its own copy and the change never reaches `<LocaleSync>` (the regression
 * covered by `locale-provider.test.tsx`).
 *
 * Services like web and docs that read locale from the URL don't need this
 * provider — they read `useCurrentLocale()` and mount `<LocaleSync>` directly.
 */
export function LocaleProvider({
  children,
  defaultLocale = 'en-US',
  onLocaleChange,
}: LocaleProviderProps) {
  const [locale, setLocaleState] = useState(() =>
    detectPreferredLocale(defaultLocale),
  );

  useEffect(() => {
    if (onLocaleChange) void onLocaleChange(locale);
  }, [locale, onLocaleChange]);

  const setLocale = useCallback(
    (newLocale: string) => {
      const resolved = isValidLocale(newLocale) ? newLocale : defaultLocale;
      if (!isValidLocale(newLocale)) {
        console.warn(
          `Invalid locale: ${newLocale}. Using default: ${defaultLocale}`,
        );
      }
      setLocaleState(resolved);
      localStorage.setItem(LOCALE_STORAGE_KEY, resolved);
    },
    [defaultLocale],
  );

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, setLocale }),
    [locale, setLocale],
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (context === undefined) {
    throw new Error('useLocale must be used within a LocaleProvider');
  }
  return context;
}
