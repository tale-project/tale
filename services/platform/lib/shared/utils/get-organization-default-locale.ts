import { defaultLocale } from '../../i18n/config';
import { SUPPORTED_AGENT_LOCALES } from '../constants/agents';

/**
 * Narrow any string to a supported agent locale. Unknown/stale values
 * (e.g. legacy `'it'` / `'es'` metadata) fall back to the app-level default.
 */
export function clampToSupportedLocale(value: unknown): string {
  if (typeof value !== 'string') return defaultLocale;
  return (SUPPORTED_AGENT_LOCALES as readonly string[]).includes(value)
    ? value
    : defaultLocale;
}

/**
 * Extracts the default locale from organization metadata.
 * Falls back to the app-level default locale ('en') if metadata
 * is missing, not JSON, or does not contain a valid supported locale.
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
    return clampToSupportedLocale(
      (parsed as { defaultLocale: unknown }).defaultLocale, // oxlint-disable-line typescript/no-unsafe-type-assertion
    );
  }
  return defaultLocale;
}
