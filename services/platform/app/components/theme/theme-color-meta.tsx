'use client';

import { useEffect } from 'react';

import { useTheme } from './theme-provider';

const THEME_COLORS = {
  light: '#fcfcfc',
  dark: '#09090b',
};

export function ThemeColorMeta() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const color =
      resolvedTheme === 'dark' ? THEME_COLORS.dark : THEME_COLORS.light;

    let metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (!metaThemeColor) {
      metaThemeColor = document.createElement('meta');
      metaThemeColor.setAttribute('name', 'theme-color');
      document.head.appendChild(metaThemeColor);
    }
    metaThemeColor.setAttribute('content', color);
  }, [resolvedTheme]);

  return null;
}
