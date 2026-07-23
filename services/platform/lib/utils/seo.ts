import { getTitleSuffix } from '@/app/lib/title-suffix';
import { i18n } from '@/lib/i18n/i18n';
import type { Messages } from '@/lib/i18n/types';

/**
 * Extracts keys from the `metadata` i18n namespace that have a `title` field.
 * Each page route defines its own metadata entry (e.g. `metadata.chat.title`),
 * and this type ensures only valid page keys are accepted.
 */
type MetadataKey = Extract<keyof Messages['metadata'], string>;
type MetadataPage = {
  [K in MetadataKey]: Messages['metadata'][K] extends {
    title: string;
  }
    ? K
    : never;
}[MetadataKey];

/**
 * Builds the meta tag array for a given page route.
 *
 * Looks up the page's `title` and optional `description` from the `metadata`
 * i18n namespace, then returns the tags expected by TanStack Start's `Meta`
 * component: a document `<title>` plus basic Open Graph tags for link previews
 * within the platform (e.g. Slack unfurls in internal channels).
 *
 * `titleOverride` lets a detail route substitute the loaded entity's own name
 * (e.g. a project's name) for the static `metadata.<key>.title` string, while
 * still reusing that key's description and the shared suffix/OG composition
 * (#2647). The key's own title stands in as the fallback when the entity
 * hasn't loaded yet (e.g. a not-found project).
 */
export function seo(key: MetadataPage, titleOverride?: string) {
  // The title suffix is the active org's name once known (cached across
  // reloads by `title-suffix`), falling back to the static "Tale" when logged
  // out or before any org branding has loaded. Composing it here — rather than
  // patching `document.title` after the fact — means the correct suffix
  // renders at head time on first paint.
  const suffix = getTitleSuffix() ?? i18n.t('suffix', { ns: 'metadata' });
  const title = titleOverride || i18n.t(`${key}.title`, { ns: 'metadata' });
  const description = i18n.t(`${key}.description`, { ns: 'metadata' });
  const fullTitle = `${title} - ${suffix}`;

  const tags: Array<Record<string, string>> = [
    { title: fullTitle },
    { name: 'og:title', content: fullTitle },
    { name: 'og:type', content: 'website' },
  ];

  if (description) {
    tags.push(
      { name: 'description', content: description },
      { name: 'og:description', content: description },
    );
  }

  return tags;
}
