import type { i18n as I18nInstance } from 'i18next';

/** The part of i18next's internal `LanguageUtil` this module wraps. */
interface LanguageUtils {
  options: { fallbackLng?: unknown };
  toResolveHierarchy: (code: unknown, fallbackCode?: unknown) => string[];
}

function isLanguageUtils(value: unknown): value is LanguageUtils {
  return (
    typeof value === 'object' &&
    value !== null &&
    'toResolveHierarchy' in value &&
    typeof value.toResolveHierarchy === 'function' &&
    'options' in value &&
    typeof value.options === 'object' &&
    value.options !== null
  );
}

const memoized = new WeakSet<object>();

/**
 * Holds each language's lookup chain (`de-CH` → `de-CH`, `de`, `en`) once.
 *
 * i18next derives that chain again on every `t()` call: it rebuilds the
 * fallback list and normalises each code through `Intl.getCanonicalLocales`,
 * though the chain depends only on the language and on the fallback
 * configuration, which do not change while the page runs. With thousands of
 * labels on a screen (a large board, a long chat list) that derivation was
 * most of what a label cost. The wrapped call answers from a map keyed by
 * language, rebuilt if the fallback configuration is ever replaced.
 *
 * Each call returns a fresh copy, because i18next mutates the array it gets
 * (`setResolvedLanguage` unshifts into `i18n.languages`). A call that names
 * its own fallback (`t(key, { fallbackLng })`) is not cached.
 */
export function memoizeLanguageHierarchy(i18n: I18nInstance): void {
  const utils: unknown = i18n.services?.languageUtils;
  if (!isLanguageUtils(utils) || memoized.has(utils)) return;
  memoized.add(utils);

  const derive = utils.toResolveHierarchy.bind(utils);
  const chains = new Map<string, readonly string[]>();
  let fallbackLng = utils.options.fallbackLng;

  utils.toResolveHierarchy = (code, fallbackCode) => {
    if (typeof code !== 'string' || fallbackCode !== undefined) {
      return derive(code, fallbackCode);
    }
    if (utils.options.fallbackLng !== fallbackLng) {
      fallbackLng = utils.options.fallbackLng;
      chains.clear();
    }
    let chain = chains.get(code);
    if (chain === undefined) {
      chain = derive(code);
      chains.set(code, chain);
    }
    return [...chain];
  };
}
