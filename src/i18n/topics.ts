import type { i18n as I18nInstance } from 'i18next';

import { registerLocaleSource } from './load-locale';

/**
 * Message topics that load with the code that reads them.
 *
 * A service may keep its catalog one file per topic and locale
 * (`messages/<locale>/<topic>.yml`, a topic being one top-level namespace).
 * With the `messageTopics` vite plugin (`@tale/ui/vite/message-topics`), every
 * module that names a topic imports it: the English file comes with the
 * module and lands here through `registerTopic`, and each other locale's file
 * is fetched when the language the session shows first needs that topic. A
 * chunk the app loads on demand waits for the topics it brings (`ready`, which
 * the plugin calls at the chunk's end), so a page renders with its words in
 * place.
 */

type Messages = Record<string, unknown>;

/** Fetches one locale's file of one topic. */
export type TopicLoader = () => Promise<Messages | null | undefined>;

export interface TopicSources {
  /**
   * Locale → topic → its file. Not English: every key falls back to it, so it
   * comes with the code that reads it.
   */
  readonly lazy: Readonly<
    Record<string, Readonly<Record<string, TopicLoader>>>
  >;
  /**
   * Fetch every topic of a locale once the session needs that locale, rather
   * than the topics registered so far: for a dev server or a test run, where
   * no chunk waits for the topics it brings.
   */
  readonly eager?: boolean;
  /**
   * How long a chunk waits for its topics before it renders in the fallback
   * language; the words replace it once they land. Defaults to 4 s.
   */
  readonly waitMs?: number;
}

const ENGLISH = 'en';
const RETRY_AFTER_MS = 10_000;

interface Load {
  readonly promise: Promise<void>;
  landed: boolean;
}

function baseOf(locale: string): string {
  return locale.split('-')[0] ?? locale;
}

const filesReadBy = new Map<string, readonly string[]>();

/** The locales whose files `locale` reads, most specific first, English aside. */
function filesRead(locale: string): readonly string[] {
  let files = filesReadBy.get(locale);
  if (files === undefined) {
    const base = baseOf(locale);
    files = base === ENGLISH ? [] : locale === base ? [base] : [locale, base];
    filesReadBy.set(locale, files);
  }
  return files;
}

function warn(error: unknown): void {
  console.warn('[i18n] a message topic did not load', error);
}

class TopicRegistry {
  private readonly registered = new Set<string>();
  /** Locales whose files a newly registered topic fetches at once. */
  private following = new Set<string>();
  private readonly loads = new Map<string, Map<string, Load>>();
  private readonly unnamed = new Set<string>();
  /** When a topic file last failed to load, so readers do not refetch it per render. */
  private readonly failedAt = new Map<string, number>();

  constructor(
    readonly i18n: I18nInstance,
    private readonly sources: TopicSources,
  ) {}

  register(topic: string, messages: Messages): void {
    this.i18n.addResourceBundle(ENGLISH, topic, messages, true, true);
    this.registered.add(topic);
    for (const locale of this.following) {
      this.fetch(locale, topic).catch(warn);
    }
  }

  /** The topics a locale's session needs now. */
  private topicsOf(locale: string): string[] {
    return this.sources.eager
      ? Object.keys(this.sources.lazy[locale] ?? {})
      : [...this.registered];
  }

  private fetch(locale: string, topic: string): Promise<void> {
    const load = this.sources.lazy[locale]?.[topic];
    if (load === undefined) return Promise.resolve();
    let byTopic = this.loads.get(locale);
    if (byTopic === undefined) {
      byTopic = new Map();
      this.loads.set(locale, byTopic);
    }
    const existing = byTopic.get(topic);
    if (existing !== undefined) return existing.promise;
    const entry: Load = {
      landed: false,
      promise: load().then(
        (messages) => {
          this.i18n.addResourceBundle(
            locale,
            topic,
            messages ?? {},
            true,
            true,
          );
          entry.landed = true;
        },
        (error: unknown) => {
          byTopic.delete(topic);
          this.failedAt.set(`${locale}\u0000${topic}`, Date.now());
          throw error;
        },
      ),
    };
    byTopic.set(topic, entry);
    return entry.promise;
  }

  private landed(locale: string, topic: string): boolean {
    if (this.sources.lazy[locale]?.[topic] === undefined) return true;
    return this.loads.get(locale)?.get(topic)?.landed === true;
  }

  isLoaded(locale: string): boolean {
    return filesRead(locale).every((file) =>
      this.topicsOf(file).every((topic) => this.landed(file, topic)),
    );
  }

  /**
   * Fetch the topics `locale` needs, and keep fetching each topic that
   * registers later in it, until the language changes.
   */
  load(locale: string): Promise<void> {
    const files = filesRead(locale);
    for (const file of files) this.following.add(file);
    return Promise.all(
      files.flatMap((file) =>
        this.topicsOf(file).map((topic) => this.fetch(file, topic)),
      ),
    ).then(() => undefined);
  }

  /** The language the session shows changed: new topics fetch in it alone. */
  follow(language: string): void {
    this.following = new Set(filesRead(language));
  }

  /** Resolves once the given topics are in for the followed locales; never rejects. */
  ready(topics: readonly string[]): Promise<void> {
    const pending = [...this.following].flatMap((locale) =>
      topics.map((topic) => this.fetch(locale, topic)),
    );
    if (pending.length === 0) return Promise.resolve();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waited = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, this.sources.waitMs ?? 4000);
    });
    return Promise.race([
      Promise.all(pending).then(() => undefined, warn),
      waited,
    ]).finally(() => clearTimeout(timer));
  }

  /** A reader of `topic` in `language` is on screen: fetch it if it is not in. */
  ensure(language: string, topic: string): void {
    if (!this.registered.has(topic) && this.isKnown(topic)) {
      this.reportUnnamed(topic);
    }
    for (const file of filesRead(language)) {
      if (this.loads.get(file)?.has(topic) === true) continue;
      const failed = this.failedAt.get(`${file}\u0000${topic}`);
      if (failed !== undefined && Date.now() - failed < RETRY_AFTER_MS)
        continue;
      if (this.sources.lazy[file]?.[topic] === undefined) continue;
      // The chunk that brought the reader should have waited for it.
      console.debug(`[i18n] "${topic}" was read in ${file} before it loaded`);
      this.fetch(file, topic).catch(warn);
    }
  }

  private isKnown(topic: string): boolean {
    return Object.values(this.sources.lazy).some(
      (topics) => topics[topic] !== undefined,
    );
  }

  private reportUnnamed(topic: string): void {
    if (this.unnamed.has(topic)) return;
    this.unnamed.add(topic);
    console.warn(
      `[i18n] the "${topic}" topic is read, but no module that loaded names it, so its English words are missing; name it where it is read (useT('${topic}'), { ns: '${topic}' }).`,
    );
  }
}

const pending: Array<readonly [string, Messages]> = [];
let attached: TopicRegistry | undefined;

/**
 * A topic's English messages, from the module the plugin generates for it;
 * kept until the service attaches its i18n instance.
 */
export function registerTopic(topic: string, messages: Messages): void {
  if (attached === undefined) pending.push([topic, messages]);
  else attached.register(topic, messages);
}

declare global {
  // oxlint-disable-next-line no-var -- a global the plugin's chunk code reads; only `var` declares one
  var __taleMessageTopics:
    | { ready: (topics: readonly string[]) => Promise<void> }
    | undefined;
}

/**
 * Serve `instance`'s messages per topic: English as modules register it, the
 * other locales from `sources` as the session needs them. `loadLocale` and
 * `isLocaleLoaded` answer for the topics registered so far.
 */
export function attachTopics(
  instance: I18nInstance,
  sources: TopicSources,
): void {
  const registry = new TopicRegistry(instance, sources);
  attached = registry;
  for (const [topic, messages] of pending.splice(0)) {
    registry.register(topic, messages);
  }
  instance.on('languageChanged', (language: string) => {
    registry.follow(language);
  });
  registerLocaleSource(instance, registry);
  globalThis.__taleMessageTopics = {
    ready: (topics) => registry.ready(topics),
  };
}

/**
 * A component reads `topic` in `language`: fetch the topic when it is not in,
 * which re-renders the readers of it once it lands. Normally the chunk that
 * brought the component waited for it already.
 */
export function ensureTopic(
  instance: I18nInstance,
  language: string,
  topic: string,
): void {
  if (attached === undefined) return;
  const owner =
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- react-i18next's per-mount copy carries `__original`, the instance; anything else has no such key
    (instance as { __original?: I18nInstance }).__original ?? instance;
  if (owner !== attached.i18n) return;
  attached.ensure(language, topic);
}
