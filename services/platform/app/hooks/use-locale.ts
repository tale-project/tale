'use client';

import { parseAcceptLanguage } from '@tale/i18n/accept-language';
import { isValidLocale } from '@tale/i18n/is-valid-locale';
import { resolveLocale } from '@tale/i18n/resolve-locale';
import { useCallback, useEffect, useState } from 'react';

import { loadDayjsLocale } from '@/lib/utils/date/format';

const STORAGE_KEY = 'user-locale';

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

/**
 * Detects, persists, and exposes the user's preferred locale. The actual
 * `i18n.changeLanguage` + `<html lang>` synchronization is handled by
 * `<LocaleSync>` from `@tale/ui/i18n/sync`, mounted by `I18nProvider`. This
 * hook only owns persistence (localStorage) and the platform-specific dayjs
 * locale loader.
 */
export function useLocale(defaultLocale = 'en-US'): {
  locale: string;
  setLocale: (newLocale: string) => void;
} {
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

  return { locale, setLocale };
}
