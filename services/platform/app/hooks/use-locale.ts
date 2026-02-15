'use client';

import { useCallback, useEffect, useState } from 'react';

import { loadDayjsLocale } from '@/lib/utils/date/format';
import { isValidLocale } from '@/lib/utils/intl/is-valid-locale';
import { parseAcceptLanguage } from '@/lib/utils/intl/parse-accept-language';
import { resolveLocale } from '@/lib/utils/intl/resolve-locale';

function detectLocale(defaultLocale: string) {
  const savedLocale = localStorage.getItem('user-locale');
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
 * Hook for managing locale state with browser detection and validation
 */
export function useLocale(defaultLocale = 'en-US') {
  const [locale, setLocaleState] = useState(() => detectLocale(defaultLocale));

  useEffect(() => {
    void loadDayjsLocale(locale).then(() => setLocaleState(locale));
  }, [locale]);

  const setLocale = useCallback(
    (newLocale: string) => {
      if (isValidLocale(newLocale)) {
        setLocaleState(newLocale);
        localStorage.setItem('user-locale', newLocale);
        void loadDayjsLocale(newLocale);
      } else {
        console.warn(
          `Invalid locale: ${newLocale}. Using default: ${defaultLocale}`,
        );
        setLocaleState(defaultLocale);
        localStorage.setItem('user-locale', defaultLocale);
        void loadDayjsLocale(defaultLocale);
      }
    },
    [defaultLocale],
  );

  return { locale, setLocale };
}
