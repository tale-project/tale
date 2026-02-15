import { isValidLocale } from './is-valid-locale';

/**
 * Resolves the best locale from an ordered list of preferred locale tags.
 * Iterates through candidates, trying each as-is, then falling back to the
 * base language with a regional suffix (e.g. "en" → "en-US").
 *
 * The candidate list should already be sorted by preference (highest first),
 * matching the order of navigator.languages or a parsed Accept-Language header.
 */
export function resolveLocale(
  candidates: readonly string[],
  defaultLocale: string,
): string {
  for (const candidate of candidates) {
    if (isValidLocale(candidate)) return candidate;

    const base = candidate.split('-')[0];
    if (base !== candidate && isValidLocale(base)) return base;

    if (base === 'en') {
      const fallback = `${base}-US`;
      if (isValidLocale(fallback)) return fallback;
    }
  }

  return defaultLocale;
}
