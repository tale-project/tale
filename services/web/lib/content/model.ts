import { SUPPORTED_LOCALES, type SupportedLocale } from '@tale/ui/i18n/locales';

/** Visible headings omit the site suffix retained in search metadata. */
export function marketingContentHeading(title: string): string {
  return title.replace(/ \| Tale$/, '');
}

export const MARKETING_CONTENT_CATEGORIES = [
  'comparisons',
  'use-cases',
] as const;
export type MarketingContentCategory =
  (typeof MARKETING_CONTENT_CATEGORIES)[number];

export const MARKETING_CONTENT_PATHS = {
  comparisons: '/compare',
  'use-cases': '/use-cases',
} as const;

export interface MarketingContentFrontmatter {
  title: string;
  description: string;
  slug: string;
  reviewed: string;
  draft: boolean;
  competitor?: string;
  relationship?: 'direct' | 'adjacent' | 'framework' | 'runtime';
}

export interface MarketingContentMetadata {
  category: MarketingContentCategory;
  locale: SupportedLocale;
  /** File slug; `index` identifies the category hub. */
  slug: string;
  /** Canonical English path, without a language prefix. */
  path: string;
  /** Localized site-relative URL. */
  url: string;
  frontmatter: MarketingContentFrontmatter;
}

export interface MarketingContentDocument extends MarketingContentMetadata {
  content: string;
}

export function marketingContentPath(
  category: MarketingContentCategory,
  slug = 'index',
): string {
  const root = MARKETING_CONTENT_PATHS[category];
  return slug === 'index' ? root : `${root}/${slug}`;
}

export function contentKey(
  page: Pick<MarketingContentMetadata, 'category' | 'locale' | 'slug'>,
): string {
  return `${page.category}/${page.locale}/${page.slug}`;
}

/** A page is released as one complete locale cluster. Partially published
 * translations must not create alternate links to missing or draft pages.
 * Preview-only records carry effective `draft: true` for the renderer's
 * noindex/no-alternates contract; source metadata is never mutated. */
export function visibleMarketingContent(
  pages: readonly MarketingContentMetadata[],
  { includeDrafts = false }: { includeDrafts?: boolean } = {},
): MarketingContentMetadata[] {
  const published = new Set(
    pages.filter((page) => !page.frontmatter.draft).map(contentKey),
  );
  const visible: MarketingContentMetadata[] = [];
  for (const page of pages) {
    const complete = SUPPORTED_LOCALES.every((locale) =>
      published.has(contentKey({ ...page, locale })),
    );
    if (complete) visible.push(page);
    else if (includeDrafts)
      visible.push({
        ...page,
        frontmatter: { ...page.frontmatter, draft: true },
      });
  }
  return visible;
}
