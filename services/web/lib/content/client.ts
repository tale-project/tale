import {
  contentKey,
  visibleMarketingContent,
  type MarketingContentCategory,
  type MarketingContentDocument,
  type MarketingContentMetadata,
} from './model';

export type {
  MarketingContentCategory,
  MarketingContentDocument,
  MarketingContentMetadata,
} from './model';

/** Explicit and dev-only: a production build cannot expose draft routes even
 * when the preview variable was accidentally left in its environment. */
export const MARKETING_CONTENT_PREVIEW =
  import.meta.env.DEV &&
  import.meta.env.VITE_MARKETING_CONTENT_PREVIEW === 'true';

const metadata = import.meta.glob<MarketingContentMetadata>(
  '../../app/content/{comparisons,use-cases,blog}/{en,de,fr}/*.md',
  { query: '?marketing-meta', import: 'default', eager: true },
);
const bodies = import.meta.glob<string>(
  '../../app/content/{comparisons,use-cases,blog}/{en,de,fr}/*.md',
  { query: '?marketing-body', import: 'default' },
);
const pages = visibleMarketingContent(Object.values(metadata), {
  includeDrafts: MARKETING_CONTENT_PREVIEW,
});
const bodyLoaders = new Map(
  Object.entries(metadata).map(([source, page]) => [
    contentKey(page),
    bodies[source],
  ]),
);

/** Metadata only: listing links/cards never downloads page bodies. */
export function listMarketingContent(
  category: MarketingContentCategory,
  locale: string,
): MarketingContentMetadata[] {
  return pages.filter(
    (page) => page.category === category && page.locale === locale,
  );
}

export async function loadMarketingContent({
  category,
  locale,
  slug = 'index',
}: {
  category: MarketingContentCategory;
  locale: string;
  slug?: string;
}): Promise<MarketingContentDocument | null> {
  const page = pages.find(
    (entry) =>
      entry.category === category &&
      entry.locale === locale &&
      entry.slug === slug,
  );
  if (!page) return null;
  const load = bodyLoaders.get(contentKey(page));
  if (!load) return null;
  const body = await load();
  if (import.meta.env.DEV || import.meta.env.SSR)
    return { ...page, content: body };
  // Build-time Markdown assets stay outside the site's JavaScript budget.
  // The lazy import downloads only this page's tiny URL wrapper.
  const response = await fetch(body);
  if (!response.ok)
    throw new Error(`Unable to load marketing content: ${page.url}`);
  return { ...page, content: await response.text() };
}
