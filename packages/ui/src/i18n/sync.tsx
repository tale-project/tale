'use client';

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface LocaleSyncProps {
  /** Active locale tag — what the i18n instance should render with. Caller
   *  is responsible for any regional-variant resolution before passing in. */
  locale: string;
  /** Optional override for the document's `<html lang>` attribute. Defaults
   *  to `locale`. Pass the bare base tag (e.g. `'de'`) when the i18n instance
   *  runs on a regional variant (`'de-CH'`) and the page should advertise
   *  the broader language. Both forms are valid BCP-47, so most callers can
   *  safely omit this prop. */
  htmlLang?: string;
}

/**
 * Mounts an effect that aligns the active i18next instance and the document's
 * `<html lang>` attribute with the given locale. Centralizes the
 * "react-to-locale-change" side effect that every Tale service needs:
 *
 *   - web / docs: locale comes from the URL (`useCurrentLocale()`); the host
 *     route renders `<LocaleSync locale={...} />` inside the I18nProvider.
 *   - platform: locale comes from the user's saved preference + browser
 *     detection (`useLocale()`); the I18nProvider renders `<LocaleSync />`
 *     once the detected value is known.
 *
 * Reads the i18n instance via `useTranslation()` so it picks up whichever
 * singleton the surrounding `<I18nextProvider>` injected.
 */
export function LocaleSync({ locale, htmlLang }: LocaleSyncProps): null {
  const { i18n } = useTranslation();
  useEffect(() => {
    if (i18n.language !== locale) {
      void i18n.changeLanguage(locale);
    }
    if (typeof document !== 'undefined') {
      document.documentElement.lang = htmlLang ?? locale;
    }
  }, [i18n, locale, htmlLang]);
  return null;
}
