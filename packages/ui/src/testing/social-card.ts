import { TALE_OG_IMAGE, TALE_SITE_URL } from '../seo/globals';

/**
 * The social card tags a site shell (`index.html`) carries until the
 * prerender swaps its `seo:start`/`seo:end` block for a page's own head: the
 * card's absolute URL on the marketing origin, and the size and type
 * `TALE_OG_IMAGE` documents, the size `services/web/tests/images.test.ts`
 * holds the card to. Docs, ui-docs and web each check their shell with it.
 */
export const SOCIAL_CARD_TAGS: Readonly<Record<string, string>> = {
  'og:image': `${TALE_SITE_URL}${TALE_OG_IMAGE.path}`,
  'og:image:width': String(TALE_OG_IMAGE.width),
  'og:image:height': String(TALE_OG_IMAGE.height),
  'og:image:type': TALE_OG_IMAGE.type,
  'twitter:image': `${TALE_SITE_URL}${TALE_OG_IMAGE.path}`,
};

const META = /<meta\b([^>]*)>/g;
const ATTRIBUTE = /([\w:-]+)\s*=\s*"([^"]*)"/g;

/** Each social card tag that `html` lacks, repeats or gives another value. */
export function socialCardTagMismatches(html: string): string[] {
  const found = new Map<string, string[]>();
  for (const [, attributes = ''] of html.matchAll(META)) {
    const attribute = new Map(
      [...attributes.matchAll(ATTRIBUTE)].map(
        ([, name = '', value = '']) => [name, value] as const,
      ),
    );
    const key = attribute.get('property') ?? attribute.get('name') ?? '';
    if (!Object.hasOwn(SOCIAL_CARD_TAGS, key)) continue;
    found.set(key, [...(found.get(key) ?? []), attribute.get('content') ?? '']);
  }
  return Object.entries(SOCIAL_CARD_TAGS).flatMap(([key, expected]) => {
    const values = found.get(key) ?? [];
    if (values.length === 1 && values[0] === expected) return [];
    const actual = values.length
      ? values.map((value) => `"${value}"`).join(', ')
      : 'no tag';
    return [`${key}: expected "${expected}", found ${actual}`];
  });
}
