import { defaultLocale } from '../../i18n/config';

/**
 * Extracts the default locale from organization metadata.
 * Falls back to the app-level default locale ('en') if metadata
 * is missing or does not contain a valid defaultLocale string.
 */
export function getOrganizationDefaultLocale(metadata: unknown): string {
  let parsed = metadata;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch (e) {
      console.warn('Failed to parse organization metadata', e);
      return defaultLocale;
    }
  }
  if (parsed && typeof parsed === 'object' && 'defaultLocale' in parsed) {
    const value = (parsed as { defaultLocale: unknown }).defaultLocale; // oxlint-disable-line typescript/no-unsafe-type-assertion
    if (typeof value === 'string') return value;
  }
  return defaultLocale;
}
