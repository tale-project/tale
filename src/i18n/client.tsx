import type { i18n as I18nInstance, TFunction } from 'i18next';
import { useContext, useSyncExternalStore } from 'react';
import { getI18n, I18nContext } from 'react-i18next';

import { ensureTopic } from './topics';

type Subscribe = (onChange: () => void) => () => void;

interface InstanceReaders {
  /** One function per namespace, so React subscribes each reader once. */
  readonly subscribeTo: (namespace: string) => Subscribe;
  /**
   * The language and how often the namespace's messages landed: a reader
   * re-renders when the language changes or its own namespace lands.
   */
  readonly snapshot: (namespace: string) => string;
  /** The bound `t` per language and namespace. */
  readonly fixed: Map<string, TFunction>;
}

const readersByInstance = new WeakMap<I18nInstance, InstanceReaders>();

function readersFor(i18n: I18nInstance): InstanceReaders {
  let readers = readersByInstance.get(i18n);
  if (readers !== undefined) return readers;
  const listeners = new Map<string, Set<() => void>>();
  const landings = new Map<string, number>();
  const snapshots = new Map<string, string>();
  const subscribers = new Map<string, Subscribe>();
  const notify = (set: Set<() => void> | undefined) => {
    if (set !== undefined) for (const onChange of set) onChange();
  };
  i18n.on('languageChanged', () => {
    snapshots.clear();
    for (const set of listeners.values()) notify(set);
  });
  // A namespace whose messages land after its readers rendered (a topic
  // fetched on first use) re-renders those readers alone.
  i18n.store?.on('added', (_language: string, namespace: string) => {
    landings.set(namespace, (landings.get(namespace) ?? 0) + 1);
    snapshots.delete(namespace);
    notify(listeners.get(namespace));
  });
  readers = {
    subscribeTo: (namespace) => {
      let subscribe = subscribers.get(namespace);
      if (subscribe === undefined) {
        subscribe = (onChange) => {
          let set = listeners.get(namespace);
          if (set === undefined) {
            set = new Set();
            listeners.set(namespace, set);
          }
          set.add(onChange);
          return () => {
            set.delete(onChange);
          };
        };
        subscribers.set(namespace, subscribe);
      }
      return subscribe;
    },
    snapshot: (namespace) => {
      let snapshot = snapshots.get(namespace);
      if (snapshot === undefined) {
        snapshot = `${i18n.language ?? ''}\u0000${landings.get(namespace) ?? 0}`;
        snapshots.set(namespace, snapshot);
      }
      return snapshot;
    },
    fixed: new Map(),
  };
  readersByInstance.set(i18n, readers);
  return readers;
}

const noSubscription = () => () => {};
const noSnapshot = () => '';

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
 * changes or messages of its own namespace land — what react-i18next's
 * `useTranslation` does with `bindI18n: 'languageChanged'` and
 * `bindI18nStore: 'added'`, narrowed to the namespace. It skips that hook's
 * per-render work: `useTranslation` re-spreads its options and re-subscribes
 * to the instance on every render, and copies the instance into a wrapper for
 * every mount, which a screen of thousands of labels paid thousands of times.
 * Here a reader subscribes once and `t` is one function per language and
 * namespace. When the service loads its messages per topic (`attachTopics`),
 * a namespace not yet in for the language is fetched, and its readers
 * re-render once it lands.
 */
export function useT(namespace: string): { t: TFunction } {
  // Both are typed as always present; at runtime the context is empty
  // outside an `I18nextProvider`, and nothing is registered before init.
  const provided: { i18n?: I18nInstance } | undefined = useContext(I18nContext);
  const registered: I18nInstance | undefined = getI18n();
  const i18n = provided?.i18n ?? registered;
  const readers = i18n === undefined ? undefined : readersFor(i18n);
  const snapshot =
    readers === undefined ? noSnapshot : () => readers.snapshot(namespace);
  useSyncExternalStore(
    readers?.subscribeTo(namespace) ?? noSubscription,
    snapshot,
    snapshot,
  );
  if (i18n === undefined || readers === undefined) return { t: keyAsText };
  const language: string | undefined = i18n.language;
  ensureTopic(i18n, language ?? '', namespace);
  const key = `${language ?? ''}\u0000${namespace}`;
  let t = readers.fixed.get(key);
  if (t === undefined) {
    t = i18n.getFixedT(language ?? null, namespace);
    readers.fixed.set(key, t);
  }
  return { t };
}
