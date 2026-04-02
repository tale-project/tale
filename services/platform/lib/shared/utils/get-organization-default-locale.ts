import { defaultLocale } from '../../i18n/config';

/**
 * Extracts the default locale from organization metadata.
 * Falls back to the app-level default locale ('en') if metadata
 * is missing or does not contain a valid defaultLocale string.
 */
export function getOrganizationDefaultLocale(metadata: unknown): string {
  if (metadata && typeof metadata === 'object' && 'defaultLocale' in metadata) {
    const value = (metadata as { defaultLocale: unknown }).defaultLocale; // oxlint-disable-line typescript/no-unsafe-type-assertion
    if (typeof value === 'string') return value;
  }
  return defaultLocale;
}
