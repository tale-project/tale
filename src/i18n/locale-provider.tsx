'use client';

import type { i18n as I18nInstance } from 'i18next';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { detectPreferredLocale, LOCALE_STORAGE_KEY } from './detect-locale';
import { isValidLocale } from './is-valid-locale';
import { isLocaleShownAtOnce, type LocaleSyncState } from './sync';

interface LocaleContextValue {
  /**
   * The language picked: stored at once, and shown once its messages are in
   * (`shownLocale`).
   */
  locale: string;
  /**
   * Pick a language. Picking the one already picked switches to it again,
   * so messages that did not load are fetched again.
   */
  setLocale: (newLocale: string) => void;
  /**
   * The language the page shows, the one a language picker marks: `locale`
   * once its messages are in; until then, and when they did not load, the
   * one it showed before.
   */
  shownLocale: string;
  /**
   * Where the switch to `locale` stands: `loading` while its messages are on
   * their way, `failed` when they did not load, else `shown`.
   */
  status: LocaleSyncState['status'];
}

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

/**
 * What the bridge that switches the page to the picked language reads and
 * reports to (`<AppShell>` renders `<LocaleSync>` with it).
 */
interface LocaleSwitch {
  /** Counts the picks and the retries: each one runs the switch again. */
  readonly attempt: number;
  readonly onStateChange: (state: LocaleSyncState) => void;
}

const LocaleSwitchContext = createContext<LocaleSwitch | undefined>(undefined);

interface LocaleProviderProps {
  children: ReactNode;
  defaultLocale?: string;
  /**
   * Optional side-effect run on mount with the detected locale and after every
   * `setLocale()` call. Use it to load locale-tied resources — platform passes
   * `loadDayjsLocale` so the matching dayjs locale is fetched lazily. Errors
   * are not caught: callers should handle their own failure modes.
   */
  onLocaleChange?: (locale: string) => void | Promise<void>;
  /**
   * The instance `<LocaleSync>` switches (`<AppShell>` passes its own): a
   * language already in its store reads as shown as soon as it is picked,
   * and any other as loading until the bridge reports on it.
   */
  i18n?: I18nInstance;
}

/**
 * Owns the user's preferred locale for services that drive locale from a
 * client-side preference rather than the URL: detects it on mount
 * (localStorage → server-rendered `window.__ACCEPT_LANGUAGE__` → browser
 * languages), persists changes to localStorage, and exposes a `useLocale()`
 * hook for consumers (language picker, date formatter, etc.).
 *
 * Mount ABOVE `<I18nextProvider>` so the locale-sync bridge — usually a small
 * `<LocaleSync>` wrapper that reads `useLocale()` — sees the same context as
 * the language picker. Without that shared context the picker only updates
 * its own copy and the change never reaches `<LocaleSync>` (the regression
 * covered by `locale-provider.test.tsx`). The bridge reports where the switch
 * stands back here (`useLocaleSwitch`), which `useLocale()` passes on as
 * `shownLocale` and `status`; without a bridge or an `i18n` to ask, the
 * picked language reads as shown.
 *
 * Services like web and docs that read locale from the URL don't need this
 * provider — they read `useCurrentLocale()` and mount `<LocaleSync>` directly.
 */
export function LocaleProvider({
  children,
  defaultLocale = 'en-US',
  onLocaleChange,
  i18n,
}: LocaleProviderProps) {
  const [locale, setLocaleState] = useState(() =>
    detectPreferredLocale(defaultLocale),
  );
  const [attempt, setAttempt] = useState(0);
  // Where the switch stands, as the bridge last reported it, with the pick
  // or retry it answers.
  const [synced, setSynced] = useState<
    (LocaleSyncState & { readonly attempt: number }) | undefined
  >(undefined);

  useEffect(() => {
    if (onLocaleChange) void onLocaleChange(locale);
  }, [locale, onLocaleChange]);

  const setLocale = useCallback(
    (newLocale: string) => {
      const resolved = isValidLocale(newLocale) ? newLocale : defaultLocale;
      if (!isValidLocale(newLocale)) {
        console.warn(
          `Invalid locale: ${newLocale}. Using default: ${defaultLocale}`,
        );
      }
      setLocaleState(resolved);
      setAttempt((count) => count + 1);
      localStorage.setItem(LOCALE_STORAGE_KEY, resolved);
    },
    [defaultLocale],
  );

  // A report on an earlier pick or retry says nothing about this one, so a
  // retry that fails at once still reads as a new failure. Until the bridge
  // reports, the instance says: a language already in its store, or the one
  // it shows, shows at once, and any other is on its way while the page
  // shows the language it showed.
  const reported = synced?.attempt === attempt ? synced : undefined;
  const waiting = i18n !== undefined && !isLocaleShownAtOnce(i18n, locale);
  const status = reported?.status ?? (waiting ? 'loading' : 'shown');
  const shownLocale =
    reported?.shownLocale ?? (waiting ? i18n.language : locale);

  // A language whose messages did not load is fetched again once the
  // browser is back online.
  useEffect(() => {
    if (status !== 'failed') return undefined;
    const retry = () => setAttempt((count) => count + 1);
    window.addEventListener('online', retry);
    return () => {
      window.removeEventListener('online', retry);
    };
  }, [status]);

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, setLocale, shownLocale, status }),
    [locale, setLocale, shownLocale, status],
  );
  const localeSwitch = useMemo<LocaleSwitch>(
    () => ({
      attempt,
      onStateChange: (state) => setSynced({ ...state, attempt }),
    }),
    [attempt],
  );

  return (
    <LocaleContext.Provider value={value}>
      <LocaleSwitchContext.Provider value={localeSwitch}>
        {children}
      </LocaleSwitchContext.Provider>
    </LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (context === undefined) {
    throw new Error('useLocale must be used within a LocaleProvider');
  }
  return context;
}

/**
 * For the bridge that switches the page to the picked language (`<AppShell>`
 * passes it to `<LocaleSync>`): each pick and retry, and where to report how
 * the switch goes.
 */
export function useLocaleSwitch(): LocaleSwitch {
  const context = useContext(LocaleSwitchContext);
  if (context === undefined) {
    throw new Error('useLocaleSwitch must be used within a LocaleProvider');
  }
  return context;
}
