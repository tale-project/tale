'use client';

import { ThemeAssetSync } from '@tale/ui/theme';

import { useTheme } from './theme-provider';

/**
 * Bridges platform's local `useTheme` to the shared `ThemeAssetSync`.
 * Platform has its own theme provider (storage key `'theme'`, distinct from
 * the shared provider's `'tale-theme'`), so we can't import the shared
 * `useTheme`. The component itself is generic — only the wiring is local.
 */
export function ThemeAssets() {
  const { resolvedTheme } = useTheme();
  return <ThemeAssetSync resolvedTheme={resolvedTheme} />;
}
