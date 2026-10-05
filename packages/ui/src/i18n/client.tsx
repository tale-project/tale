import type { i18n as I18nInstance, TFunction } from 'i18next';
import { useContext, useSyncExternalStore } from 'react';
import { getI18n, I18nContext } from 'react-i18next';

interface InstanceReaders {
  /** One function per instance, so React subscribes each reader once. */
  readonly subscribe: (onChange: () => void) => () => void;
  readonly language: () => string | undefined;
  /** The bound `t` per language and namespace. */
  readonly fixed: Map<string, TFunction>;
}

const readersByInstance = new WeakMap<I18nInstance, InstanceReaders>();

function readersFor(i18n: I18nInstance): InstanceReaders {
  let readers = readersByInstance.get(i18n);
  if (readers === undefined) {
    readers = {
      subscribe: (onChange) => {
        i18n.on('languageChanged', onChange);
        return () => i18n.off('languageChanged', onChange);
      },
      language: () => i18n.language,
      fixed: new Map(),
    };
    readersByInstance.set(i18n, readers);
  }
  return readers;
}

const noSubscription = () => () => {};
const noLanguage = () => undefined;

/** Before any instance exists a key reads as itself, as react-i18next does. */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- TFunction's overloads cannot be written as a literal; this one answers the key for every overload
const keyAsText = ((key: unknown) =>
  typeof key === 'string' ? key : '') as TFunction;

/**
 * `useT(namespace)` returns the i18next `t` function bound to the given
 * namespace. The namespace type is left open so each app can constrain it
 * with its own message bundle types via a typed wrapper.
 *
 * It reads the instance from `I18nextProvider` (else the one
 * `initReactI18next` registered) and re-renders only when the language
 * changes — what react-i18next's `useTranslation` does with this app's
 * options (`bindI18n: 'languageChanged'`, bundles loaded up front). It skips
 * that hook's per-render work: `useTranslation` re-spreads its options and
 * re-subscribes to the instance on every render, and copies the instance
 * into a wrapper for every mount, which a screen of thousands of labels paid
 * thousands of times. Here a reader subscribes once and `t` is one function
 * per language and namespace.
 */
export function useT(namespace: string): { t: TFunction } {
  // Both are typed as always present; at runtime the context is empty
  // outside an `I18nextProvider`, and nothing is registered before init.
  const provided: { i18n?: I18nInstance } | undefined = useContext(I18nContext);
  const registered: I18nInstance | undefined = getI18n();
  const i18n = provided?.i18n ?? registered;
  const readers = i18n === undefined ? undefined : readersFor(i18n);
  const language = useSyncExternalStore(
    readers?.subscribe ?? noSubscription,
    readers?.language ?? noLanguage,
    readers?.language ?? noLanguage,
  );
  if (i18n === undefined || readers === undefined) return { t: keyAsText };
  const key = `${language ?? ''}\u0000${namespace}`;
  let t = readers.fixed.get(key);
  if (t === undefined) {
    t = i18n.getFixedT(language ?? null, namespace);
    readers.fixed.set(key, t);
  }
  return { t };
}
