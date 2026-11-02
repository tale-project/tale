'use client';

import type { i18n as I18nInstance } from 'i18next';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { isLocaleLoaded, loadLocale } from './load-locale';

/** Where the switch to a locale stands. */
export interface LocaleSyncState {
  /** The locale switched to. */
  readonly locale: string;
  /**
   * `loading` while its messages are on their way, `shown` once the page
   * shows it, `failed` when they did not load.
   */
  readonly status: 'loading' | 'shown' | 'failed';
  /**
   * The language the page shows: `locale` once it is shown; until then, and
   * when its messages did not load, the one it showed before.
   */
  readonly shownLocale: string;
}

/**
 * Whether switching `i18n` to `locale` shows it at once: its messages are
 * in, or the instance shows it already, as when a session went ahead before
 * every topic had landed (a first frame waits for them only so long): those
 * still on their way read English until they land.
 */
export function isLocaleShownAtOnce(
  i18n: I18nInstance,
  locale: string,
): boolean {
  return i18n.language === locale || isLocaleLoaded(i18n, locale);
}

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
  /**
   * Changed to switch to the same `locale` again: messages that did not load
   * are fetched again (`loadLocale` forgets a failed fetch).
   */
  attempt?: number;
  /** Told where the switch to `locale` stands, each time that changes. */
  onStateChange?: (state: LocaleSyncState) => void;
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
 * reader re-renders with its words present (per topic, once each has landed
 * or failed: one that failed reads English until a retry brings it); until
 * then the page stays in the language it shows, and so does `<html lang>`.
 * A locale the instance shows already is shown at once, `<html lang>`
 * included, whatever is still on its way (`isLocaleShownAtOnce`).
 * `onStateChange` hears where the switch stands, so a language picker can
 * mark the language the page shows rather than the one it waits for.
 */
export function LocaleSync({
  locale,
  htmlLang,
  attempt,
  onStateChange,
}: LocaleSyncProps): null {
  const { i18n } = useTranslation();
  // The caller's latest callback, without switching again when it changes.
  const report = useRef(onStateChange);
  report.current = onStateChange;
  useEffect(() => {
    const show = () => {
      if (i18n.language !== locale) void i18n.changeLanguage(locale);
      if (typeof document !== 'undefined') {
        document.documentElement.lang = htmlLang ?? locale;
      }
      report.current?.({ locale, status: 'shown', shownLocale: locale });
    };
    const atOnce = isLocaleShownAtOnce(i18n, locale);
    let current = true;
    // Asked for even when its messages are in: a switch still fetching
    // another language is then given up, and the pages loaded next no
    // longer fetch or wait for it.
    loadLocale(i18n, locale).then(
      () => {
        if (current && !atOnce) show();
      },
      (error: unknown) => {
        console.warn(
          `[i18n] the ${locale} messages did not load; the page stays in ${i18n.language}`,
          error,
        );
        if (current && !atOnce) {
          report.current?.({
            locale,
            status: 'failed',
            shownLocale: i18n.language,
          });
        }
      },
    );
    if (atOnce) {
      show();
    } else {
      report.current?.({
        locale,
        status: 'loading',
        shownLocale: i18n.language,
      });
    }
    return () => {
      current = false;
    };
    // `attempt` is not read: a new one runs the switch again.
  }, [i18n, locale, htmlLang, attempt]);
  return null;
}
