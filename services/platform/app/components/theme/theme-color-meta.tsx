'use client';

import { useTheme } from './theme-provider';
import { useEffect, useState } from 'react';

const THEME_COLORS = {
  light: '#fcfcfc',
  dark: '#09090b',
};

export function ThemeColorMeta() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    const color =
      resolvedTheme === 'dark' ? THEME_COLORS.dark : THEME_COLORS.light;

    // Update or create the theme-color meta tag
    let metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (!metaThemeColor) {
      metaThemeColor = document.createElement('meta');
      metaThemeColor.setAttribute('name', 'theme-color');
      document.head.appendChild(metaThemeColor);
    }
    metaThemeColor.setAttribute('content', color);
  }, [resolvedTheme, mounted]);

  return null;
}
