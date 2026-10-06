/**
 * Catalogs kept one file per topic and locale (`messages/<locale>/<topic>.yml`,
 * a topic being one top-level namespace), read through `import.meta.glob`.
 * The glob has to stay at the call site (Vite requires a literal pattern);
 * these turn its result into bundles: `{ locale: { topic: messages } }`.
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
 * One locale's bundle from a lazy glob of topic files
 * (`import.meta.glob('…/messages/de/*.yml', { import: 'default' })`), every
 * topic file fetched at once.
 */
export async function loadLocaleTopics(
  modules: Record<string, () => Promise<Messages | null | undefined>>,
  locale: string,
): Promise<Bundle> {
  const entries = Object.entries(modules).flatMap(([path, load]) => {
    const file = topicFileOf(path);
    return file?.locale === locale ? [{ topic: file.topic, load }] : [];
  });
  const loaded = await Promise.all(
    entries.map(
      async ({ topic, load }) => [topic, (await load()) ?? {}] as const,
    ),
  );
  return Object.fromEntries(loaded);
}
