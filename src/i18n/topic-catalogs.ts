/**
 * Catalogs kept one file per topic and locale (`messages/<locale>/<topic>.yml`,
 * a topic being one top-level namespace), read through `import.meta.glob`.
 * The glob has to stay at the call site (Vite requires a literal pattern);
 * these turn its result into bundles (`{ locale: { topic: messages } }`) or
 * into per-topic loaders.
 */

type Messages = Record<string, unknown>;
type Bundle = Record<string, Messages>;

/** `…/<locale>/<topic>.yml` (or `.yaml`, `.json`). */
const TOPIC_FILE = /\/([^/]+)\/([^/]+)\.(?:ya?ml|json)$/;

/** The locale and topic a topic file's path names. */
export function topicFileOf(
  path: string,
): { locale: string; topic: string } | undefined {
  const match = TOPIC_FILE.exec(path);
  if (!match) return undefined;
  return { locale: match[1], topic: match[2] };
}

/**
 * Bundles by locale from an eager glob of topic files
 * (`import.meta.glob('…/messages/en/*.yml', { eager: true, import: 'default' })`).
 */
export function catalogsByLocale(
  modules: Record<string, Messages | null | undefined>,
): Record<string, Bundle> {
  const out: Record<string, Bundle> = {};
  for (const [path, messages] of Object.entries(modules)) {
    const file = topicFileOf(path);
    if (file === undefined) continue;
    (out[file.locale] ??= {})[file.topic] = messages ?? {};
  }
  return out;
}

/**
 * Each topic file's loader, by locale and topic, from a lazy glob of topic
 * files (`import.meta.glob(patterns, { import: 'default' })` over
 * `messages/<locale>/<topic>.yml`): what `initServiceI18n` takes as
 * `topics.lazy`.
 */
export function topicLoaders(
  modules: Record<string, () => Promise<Messages | null | undefined>>,
): Record<string, Record<string, () => Promise<Messages | null | undefined>>> {
  const out: Record<
    string,
    Record<string, () => Promise<Messages | null | undefined>>
  > = {};
  for (const [path, load] of Object.entries(modules)) {
    const file = topicFileOf(path);
    if (file === undefined) continue;
    (out[file.locale] ??= {})[file.topic] = load;
  }
  return out;
}
