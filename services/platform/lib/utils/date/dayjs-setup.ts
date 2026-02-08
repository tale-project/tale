import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import relativeTime from 'dayjs/plugin/relativeTime';
import isToday from 'dayjs/plugin/isToday';
import isYesterday from 'dayjs/plugin/isYesterday';
import localizedFormat from 'dayjs/plugin/localizedFormat';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';

// Only import the default locale eagerly — all others are loaded on demand
import 'dayjs/locale/en';

// Extend dayjs with plugins
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(relativeTime);
dayjs.extend(isToday);
dayjs.extend(isYesterday);
dayjs.extend(localizedFormat);
dayjs.extend(customParseFormat);
dayjs.extend(isSameOrBefore);
dayjs.extend(isSameOrAfter);

// Set default locale to English
dayjs.locale('en');

const LOCALE_IMPORTS: Record<string, () => Promise<unknown>> = {
  'en-au': () => import('dayjs/locale/en-au'),
  'en-ca': () => import('dayjs/locale/en-ca'),
  'en-gb': () => import('dayjs/locale/en-gb'),
  'en-ie': () => import('dayjs/locale/en-ie'),
  'en-in': () => import('dayjs/locale/en-in'),
  'en-nz': () => import('dayjs/locale/en-nz'),
  'en-sg': () => import('dayjs/locale/en-sg'),
  'de': () => import('dayjs/locale/de'),
  'de-at': () => import('dayjs/locale/de-at'),
  'de-ch': () => import('dayjs/locale/de-ch'),
  'fr': () => import('dayjs/locale/fr'),
  'fr-ca': () => import('dayjs/locale/fr-ca'),
  'fr-ch': () => import('dayjs/locale/fr-ch'),
  'zh': () => import('dayjs/locale/zh'),
  'zh-cn': () => import('dayjs/locale/zh-cn'),
  'zh-hk': () => import('dayjs/locale/zh-hk'),
  'zh-tw': () => import('dayjs/locale/zh-tw'),
  'nl': () => import('dayjs/locale/nl'),
  'nl-be': () => import('dayjs/locale/nl-be'),
  'es': () => import('dayjs/locale/es'),
  'it': () => import('dayjs/locale/it'),
  'it-ch': () => import('dayjs/locale/it-ch'),
  'pt': () => import('dayjs/locale/pt'),
  'pt-br': () => import('dayjs/locale/pt-br'),
  'ja': () => import('dayjs/locale/ja'),
  'ko': () => import('dayjs/locale/ko'),
  'sv': () => import('dayjs/locale/sv'),
  'da': () => import('dayjs/locale/da'),
  'fi': () => import('dayjs/locale/fi'),
  'nb': () => import('dayjs/locale/nb'),
  'pl': () => import('dayjs/locale/pl'),
  'ru': () => import('dayjs/locale/ru'),
  'tr': () => import('dayjs/locale/tr'),
  'ar': () => import('dayjs/locale/ar'),
};

const loadedLocales = new Set<string>(['en']);
const pendingLoads = new Map<string, Promise<void>>();

/**
 * Dynamically load a dayjs locale. Returns a promise that resolves once the
 * locale is registered with dayjs. Repeated calls for the same locale are
 * de-duplicated.
 */
export function loadDayjsLocale(locale: string): Promise<void> {
  const key = locale.toLowerCase().replace(/_/g, '-');
  if (loadedLocales.has(key)) return Promise.resolve();

  const existing = pendingLoads.get(key);
  if (existing) return existing;

  const base = key.split('-')[0];
  const importFn = LOCALE_IMPORTS[key] ?? LOCALE_IMPORTS[base];
  if (!importFn) return Promise.resolve();

  const promise = importFn()
    .then(() => {
      loadedLocales.add(key);
    })
    .catch(() => {
      // Locale import failed — fall back to 'en' silently
    })
    .finally(() => {
      pendingLoads.delete(key);
    });

  pendingLoads.set(key, promise);
  return promise;
}

export function isDayjsLocaleLoaded(locale: string): boolean {
  const key = locale.toLowerCase().replace(/_/g, '-');
  return loadedLocales.has(key);
}

export default dayjs;
