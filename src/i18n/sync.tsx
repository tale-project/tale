'use client';

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { isLocaleLoaded, loadLocale } from './load-locale';

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
 *     route renders `<LocaleSync locale={...} />` inside the I18nextProvider.
 *   - platform / template services: locale comes from the user's saved
 *     preference + browser detection (`useLocale()` from
 *     `@tale/i18n/locale-provider`); the app shell renders `<LocaleSync />`
 *     once the detected value is known.
 *
 * Reads the i18n instance via `useTranslation()` so it picks up whichever
 * singleton the surrounding `<I18nextProvider>` injected.
 *
 * A locale whose messages the service fetches on first use (`lazyBundles`,
 * or per topic with `topics`) is switched to once they have landed, so every
 * reader re-renders with its words present; until then the page stays in the
 * language it shows, and so does `<html lang>`.
 */
export function LocaleSync({ locale, htmlLang }: LocaleSyncProps): null {
  const { i18n } = useTranslation();
  useEffect(() => {
    const show = () => {
      if (i18n.language !== locale) void i18n.changeLanguage(locale);
      if (typeof document !== 'undefined') {
        document.documentElement.lang = htmlLang ?? locale;
      }
    };
    if (isLocaleLoaded(i18n, locale)) {
      show();
      return undefined;
    }
    let current = true;
    loadLocale(i18n, locale).then(
      () => {
        if (current) show();
      },
      (error: unknown) => {
        console.warn(
          `[i18n] the ${locale} messages did not load; the page stays in ${i18n.language}`,
          error,
        );
      },
    );
    return () => {
      current = false;
    };
  }, [i18n, locale, htmlLang]);
  return null;
}
