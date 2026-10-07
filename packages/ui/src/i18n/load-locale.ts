import type { i18n as I18nInstance } from 'i18next';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type Bundle = Record<string, Record<string, unknown>>;

interface LocaleLoaders {
  /** Base locale → what fetches its bundle, merged and ready for the store. */
  readonly fetchers: Map<string, () => Promise<Bundle>>;
  /** Base locale → its fetch, in flight or landed. */
  readonly loads: Map<string, { promise: Promise<void>; landed: boolean }>;
}

const loadersByInstance = new WeakMap<I18nInstance, LocaleLoaders>();

/**
 * Where an instance that loads its messages per topic (`attachTopics`) gets
 * the messages of a locale: the topics registered so far.
 */
export interface LocaleSource {
  load(locale: string): Promise<void>;
  isLoaded(locale: string): boolean;
}

const sourcesByInstance = new WeakMap<I18nInstance, LocaleSource>();

/**
 * The instance itself: react-i18next's `useTranslation` hands out a copy of
 * it per mount and language, which points back at it as `__original`.
 */
function original(instance: I18nInstance): I18nInstance {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- react-i18next's copy carries `__original`, an i18n instance; anything else has no such key
  return (instance as { __original?: I18nInstance }).__original ?? instance;
}

function baseOf(locale: string): string {
  return locale.split('-')[0] ?? locale;
}

/**
 * Register how `instance` fetches the bundle of a base locale it was
 * initialised without (`initServiceI18n`'s `lazyBundles`).
 */
export function registerLocaleLoader(
  instance: I18nInstance,
  locale: string,
  fetch: () => Promise<Bundle>,
): void {
  const owner = original(instance);
  let loaders = loadersByInstance.get(owner);
  if (loaders === undefined) {
    loaders = { fetchers: new Map(), loads: new Map() };
    loadersByInstance.set(owner, loaders);
  }
  loaders.fetchers.set(baseOf(locale), fetch);
}

/** Answer `loadLocale` and `isLocaleLoaded` for `instance` from `source`. */
export function registerLocaleSource(
  instance: I18nInstance,
  source: LocaleSource,
): void {
  sourcesByInstance.set(original(instance), source);
}

/**
 * Whether the messages `locale` reads (a regional variant reads its base's)
 * are in `instance`'s store: always, for a locale it was initialised with.
 */
export function isLocaleLoaded(
  instance: I18nInstance,
  locale: string,
): boolean {
  const source = sourcesByInstance.get(original(instance));
  if (source !== undefined) return source.isLoaded(locale);
  const base = baseOf(locale);
  const loaders = loadersByInstance.get(original(instance));
  if (loaders?.fetchers.has(base) !== true) return true;
  return loaders.loads.get(base)?.landed === true;
}

/**
 * Fetch the messages `locale` reads into `instance`'s store, once. Resolves at
 * once for a locale the instance was initialised with. The bundle lands
 * before the promise resolves, so a caller that switches the language
 * afterwards re-renders every reader with its words present. A failed fetch
 * is forgotten: the next call tries again.
 */
export function loadLocale(
  instance: I18nInstance,
  locale: string,
): Promise<void> {
  const owner = original(instance);
  const source = sourcesByInstance.get(owner);
  if (source !== undefined) return source.load(locale);
  const base = baseOf(locale);
  const loaders = loadersByInstance.get(owner);
  const fetch = loaders?.fetchers.get(base);
  if (loaders === undefined || fetch === undefined) return Promise.resolve();
  const existing = loaders.loads.get(base);
  if (existing !== undefined) return existing.promise;
  const load = {
    landed: false,
    promise: fetch().then(
      (bundle) => {
        for (const [namespace, messages] of Object.entries(bundle)) {
          owner.addResourceBundle(base, namespace, messages, true, true);
        }
        load.landed = true;
      },
      (error: unknown) => {
        loaders.loads.delete(base);
        throw error;
      },
    ),
  };
  loaders.loads.set(base, load);
  return load.promise;
}

/**
 * Whether the messages of every given locale are in the store, fetching the
 * missing ones: for a screen that reads other languages than the session's
 * (`i18n.getFixedT(locale)`), which re-renders once they have landed.
 */
export function useLocalesLoaded(locales: readonly string[]): boolean {
  const { i18n } = useTranslation();
  const key = locales.join(',');
  const [landedKey, setLandedKey] = useState<string | null>(null);
  const landed =
    landedKey === key ||
    locales.every((locale) => isLocaleLoaded(i18n, locale));
  useEffect(() => {
    if (landed) return undefined;
    let current = true;
    Promise.all(key.split(',').map((locale) => loadLocale(i18n, locale))).then(
      () => {
        if (current) setLandedKey(key);
      },
      (error: unknown) => {
        console.warn(`[i18n] messages for ${key} did not load`, error);
      },
    );
    return () => {
      current = false;
    };
  }, [i18n, key, landed]);
  return landed;
}
