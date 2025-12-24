/**
 * i18n Configuration
 *
 * Defines supported locales and default settings.
 * This is the central configuration for the i18n abstraction layer.
 */

export const locales = ['en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';

/**
 * Mapping for dayjs locale codes.
 * Used to sync the i18n locale with dayjs formatting.
 */
export const dayjsLocaleMap: Record<Locale, string> = {
  en: 'en',
};

/**
 * Check if a locale string is a supported locale
 */
export function isSupportedLocale(locale: string): locale is Locale {
  return locales.includes(locale as Locale);
}
