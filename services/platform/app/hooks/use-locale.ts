'use client';

import { useCallback, useState } from 'react';
import { isValidLocale } from '@/lib/utils/intl/is-valid-locale';
import { loadDayjsLocale } from '@/lib/utils/date/format';

function detectLocale(defaultLocale: string) {
  const savedLocale = localStorage.getItem('user-locale');
  if (savedLocale && isValidLocale(savedLocale)) return savedLocale;

  const browserLocale = navigator.language || navigator.languages?.[0];
  if (browserLocale && isValidLocale(browserLocale)) return browserLocale;

  if (browserLocale) {
    const fallbackLocale = `${browserLocale.split('-')[0]}-US`;
    if (isValidLocale(fallbackLocale)) return fallbackLocale;
  }

  return defaultLocale;
}

/**
 * Hook for managing locale state with browser detection and validation
 */
export function useLocale(defaultLocale = 'en-US') {
  const [locale, setLocaleState] = useState(() => {
    const detected = detectLocale(defaultLocale);
    loadDayjsLocale(detected);
    return detected;
  });

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
