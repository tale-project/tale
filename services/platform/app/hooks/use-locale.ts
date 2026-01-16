'use client';

import { useState, useEffect } from 'react';
import { isValidLocale } from '@/lib/utils/intl/is-valid-locale';

export interface UseLocaleReturn {
  locale: string;
  setLocale: (locale: string) => void;
  isValidLocale: (locale: string) => boolean;
}

/**
 * Hook for managing locale state with browser detection and validation
 */
export function useLocale(defaultLocale: string = 'en-US'): UseLocaleReturn {
  const [locale, setLocaleState] = useState<string>(defaultLocale);

  // Initialize locale from browser or localStorage
  useEffect(() => {
    // Try to get locale from localStorage first
    const savedLocale = localStorage.getItem('user-locale');
    if (savedLocale && isValidLocale(savedLocale)) {
      setLocaleState(savedLocale);
      return;
    }

    // Fall back to browser locale
    const browserLocale = navigator.language || navigator.languages?.[0];
    if (browserLocale && isValidLocale(browserLocale)) {
      setLocaleState(browserLocale);
    } else if (browserLocale) {
      // Extract language part and try to construct a fallback locale
      const browserLang = browserLocale.split('-')[0];
      const fallbackLocale = `${browserLang}-US`;
      if (isValidLocale(fallbackLocale)) {
        setLocaleState(fallbackLocale);
      }
    }
  }, []);

  // Set locale with validation and persistence
  const setLocale = (newLocale: string) => {
    if (isValidLocale(newLocale)) {
      setLocaleState(newLocale);
      localStorage.setItem('user-locale', newLocale);
    } else {
      console.warn(
        `Invalid locale: ${newLocale}. Using default: ${defaultLocale}`,
      );
      setLocaleState(defaultLocale);
      localStorage.setItem('user-locale', defaultLocale);
    }
  };

  return {
    locale,
    setLocale,
    isValidLocale,
  };
}
