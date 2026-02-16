import type { Messages } from '@/lib/i18n/types';

import { i18n } from '@/lib/i18n/i18n';

/**
 * Extracts keys from the `metadata` i18n namespace that have a `title` field.
 * Each page route defines its own metadata entry (e.g. `metadata.chat.title`),
 * and this type ensures only valid page keys are accepted.
 */
type MetadataPage = {
  [K in keyof Messages['metadata']]: Messages['metadata'][K] extends {
    title: string;
  }
    ? K
    : never;
}[keyof Messages['metadata']];

/**
 * Builds the meta tag array for a given page route.
 *
 * Looks up the page's `title` and optional `description` from the `metadata`
 * i18n namespace, then returns the tags expected by TanStack Start's `Meta`
 * component: a document `<title>` plus basic Open Graph tags for link previews
 * within the platform (e.g. Slack unfurls in internal channels).
 */
export function seo(key: MetadataPage) {
  const suffix = i18n.t('suffix', { ns: 'metadata' });
  const title = i18n.t(`${key}.title`, { ns: 'metadata' });
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
