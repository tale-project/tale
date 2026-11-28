'use client';

import { ThemeAssetSync, useTheme } from '@tale/ui/theme';

/**
 * Keeps favicon and theme-color meta tags aligned with the active theme.
 * Mounted from `__root.tsx` so it always sits inside the `<AppShell>`
 * theme tree.
 */
export function ThemeAssets() {
  const { resolvedTheme } = useTheme();
  return <ThemeAssetSync resolvedTheme={resolvedTheme} />;
}
