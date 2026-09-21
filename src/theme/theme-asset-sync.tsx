import { useEffect } from 'react';

import type { ResolvedTheme } from './theme-provider';

interface ThemeAssetSyncProps {
  resolvedTheme: ResolvedTheme;
}

/**
 * Keeps favicon `<link>` and `<meta name="theme-color">` aligned with the
 * user's explicit theme pick. Without this they only follow OS-level
 * `prefers-color-scheme`, so picking "dark" on a light OS would leave a
 * light favicon in the tab and a white theme-color in the mobile chrome.
 *
 * Convention: each app's `index.html` exposes the pair of elements by id —
 *   - `favicon-light`, `favicon-dark` (the per-theme `<link rel="icon">`)
 *   - `theme-color`, `theme-color-dark` (the per-theme `<meta name="theme-color">`)
 *
 * The component flips each element's `media` attribute between `all` and
 * `not all` based on the resolved theme. Apps that lack any of the four
 * elements are silently skipped, so it's safe to mount even when only some
 * are present.
 *
 * Passing `resolvedTheme` as a prop instead of reading from a context lets
 * the same component serve apps on the shared `@tale/ui/theme` provider and
 * apps with their own provider (e.g. `services/platform`).
 */
export function ThemeAssetSync({ resolvedTheme }: ThemeAssetSyncProps): null {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const setMedia = (id: string, match: boolean) => {
      const el = document.getElementById(id);
      if (el) el.setAttribute('media', match ? 'all' : 'not all');
    };
    const isDark = resolvedTheme === 'dark';
    setMedia('favicon-light', !isDark);
    setMedia('favicon-dark', isDark);
    setMedia('theme-color', !isDark);
    setMedia('theme-color-dark', isDark);
  }, [resolvedTheme]);
  return null;
}
