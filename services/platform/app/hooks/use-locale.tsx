'use client';

import { parseAcceptLanguage } from '@tale/i18n/accept-language';
import { isValidLocale } from '@tale/i18n/is-valid-locale';
import { resolveLocale } from '@tale/i18n/resolve-locale';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { loadDayjsLocale } from '@/lib/utils/date/format';

const STORAGE_KEY = 'user-locale';

interface LocaleContextValue {
  locale: string;
  setLocale: (newLocale: string) => void;
}

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

function detectLocale(defaultLocale: string): string {
  const savedLocale = localStorage.getItem(STORAGE_KEY);
  if (savedLocale && isValidLocale(savedLocale)) return savedLocale;

  const serverHeader = window.__ACCEPT_LANGUAGE__;
  if (serverHeader) {
    return resolveLocale(parseAcceptLanguage(serverHeader), defaultLocale);
  }

  return resolveLocale(
    navigator.languages ?? [navigator.language],
    defaultLocale,
  );
}

interface LocaleProviderProps {
  children: ReactNode;
  defaultLocale?: string;
}

/**
 * Owns the user's preferred locale: detects it on mount (localStorage →
 * server-rendered Accept-Language → browser languages), persists changes to
 * localStorage, and loads the matching dayjs locale. The actual
 * `i18n.changeLanguage` + `<html lang>` synchronization is handled by
 * `<LocaleSync>` from `@tale/ui/i18n/sync`, mounted by `I18nProvider`.
 *
 * Must be mounted ABOVE `I18nProvider` so the locale-sync bridge reads from
 * the same source as the language picker — without the shared context, the
 * picker would only update its own copy and the change would not reach
 * `<LocaleSync>` until the next page load.
 */
export function LocaleProvider({
  children,
  defaultLocale = 'en-US',
}: LocaleProviderProps) {
  const [locale, setLocaleState] = useState(() => detectLocale(defaultLocale));

  useEffect(() => {
    void loadDayjsLocale(locale);
  }, [locale]);

  const setLocale = useCallback(
    (newLocale: string) => {
      const resolved = isValidLocale(newLocale) ? newLocale : defaultLocale;
      if (!isValidLocale(newLocale)) {
        console.warn(
          `Invalid locale: ${newLocale}. Using default: ${defaultLocale}`,
        );
      }
      setLocaleState(resolved);
      localStorage.setItem(STORAGE_KEY, resolved);
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
