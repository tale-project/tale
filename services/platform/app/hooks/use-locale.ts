'use client';

import { useCallback, useEffect, useState } from 'react';

import { loadDayjsLocale } from '@/lib/utils/date/format';
import { isValidLocale } from '@/lib/utils/intl/is-valid-locale';

function detectLocale(defaultLocale: string) {
  const savedLocale = localStorage.getItem('user-locale');
  if (savedLocale && isValidLocale(savedLocale)) return savedLocale;

  const browserLocale = navigator.language || navigator.languages?.[0];
  if (browserLocale && isValidLocale(browserLocale)) return browserLocale;

  if (browserLocale) {
    const base = browserLocale.split('-')[0];
    if (base === 'en') {
      const fallbackLocale = `${base}-US`;
      if (isValidLocale(fallbackLocale)) return fallbackLocale;
    }
  }

  return defaultLocale;
}

/**
 * Hook for managing locale state with browser detection and validation
 */
export function useLocale(defaultLocale = 'en-US') {
  const [locale, setLocaleState] = useState(() => detectLocale(defaultLocale));

  useEffect(() => {
    loadDayjsLocale(locale).then(() => setLocaleState(locale));
  }, [locale]);

  const setLocale = useCallback(
    (newLocale: string) => {
      if (isValidLocale(newLocale)) {
        setLocaleState(newLocale);
        localStorage.setItem('user-locale', newLocale);
        loadDayjsLocale(newLocale);
      } else {
        console.warn(
          `Invalid locale: ${newLocale}. Using default: ${defaultLocale}`,
        );
        setLocaleState(defaultLocale);
        localStorage.setItem('user-locale', defaultLocale);
        loadDayjsLocale(defaultLocale);
      }
    },
    [defaultLocale],
  );

  return { locale, setLocale };
}
