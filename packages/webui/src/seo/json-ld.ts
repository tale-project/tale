/**
 * Builders for the JSON-LD blocks Tale emits. Each function returns a
 * stringified object ready to drop inside a `<script type="application/ld+json">`.
 */

interface OrganizationParams {
  name: string;
  url: string;
  logoUrl?: string;
  sameAs?: readonly string[];
}

/**
 * Builds a JSON-LD `Organization` block. Useful on the homepage so Google can
 * surface a richer knowledge-panel result (logo, social profiles).
 *
 * @example
 *   buildOrganizationJsonLd({
 *     name: 'Tale',
 *     url: 'https://tale.dev',
 *     logoUrl: 'https://tale.dev/logo.png',
 *     sameAs: ['https://x.com/taledev', 'https://github.com/tale'],
 *   });
 */
export function buildOrganizationJsonLd(params: OrganizationParams): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: params.name,
    url: params.url,
    ...(params.logoUrl ? { logo: params.logoUrl } : {}),
    ...(params.sameAs && params.sameAs.length > 0
      ? { sameAs: [...params.sameAs] }
      : {}),
  });
}

interface WebSiteParams {
  name: string;
  url: string;
  /**
   * Full URL template Google will hit when a user submits the sitelinks search
   * box. Must include the literal token `{search_term_string}`. Typical value:
   * `${siteUrl}/?q={search_term_string}`.
   */
  searchUrlTemplate?: string;
}

/**
 * Builds a JSON-LD `WebSite` block. When `searchUrlTemplate` is provided, a
 * `potentialAction.SearchAction` is attached so Google may render a sitelinks
 * search box pointing at e.g. `${siteUrl}/?q={search_term_string}`.
 *
 * @example
 *   buildWebSiteJsonLd({
 *     name: 'Tale',
 *     url: 'https://tale.dev',
 *     searchUrlTemplate: 'https://tale.dev/?q={search_term_string}',
 *   });
 */
export function buildWebSiteJsonLd(params: WebSiteParams): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: params.name,
    url: params.url,
    ...(params.searchUrlTemplate
      ? {
          potentialAction: {
            '@type': 'SearchAction',
            target: {
              '@type': 'EntryPoint',
              urlTemplate: params.searchUrlTemplate,
            },
            'query-input': 'required name=search_term_string',
          },
        }
      : {}),
  });
}

interface ArticleParams {
  headline: string;
  description: string;
  url: string;
  datePublished?: string;
  dateModified?: string;
  authorName?: string;
  publisherName?: string;
  /** Absolute URL to the publisher logo. Recommended by Google for Article. */
  publisherLogoUrl?: string;
  imageUrl?: string;
  inLanguage?: string;
}

export function buildArticleJsonLd(params: ArticleParams): string {
  const publisher = params.publisherName
    ? {
        publisher: {
          '@type': 'Organization',
          name: params.publisherName,
          ...(params.publisherLogoUrl
            ? {
                logo: {
                  '@type': 'ImageObject',
                  url: params.publisherLogoUrl,
                },
              }
            : {}),
        },
      }
    : {};

  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: params.headline,
    description: params.description,
    mainEntityOfPage: { '@type': 'WebPage', '@id': params.url },
    ...(params.datePublished ? { datePublished: params.datePublished } : {}),
    ...(params.dateModified ? { dateModified: params.dateModified } : {}),
    ...(params.authorName
      ? { author: { '@type': 'Organization', name: params.authorName } }
      : {}),
    ...publisher,
    ...(params.imageUrl ? { image: params.imageUrl } : {}),
    ...(params.inLanguage ? { inLanguage: params.inLanguage } : {}),
  });
}

export interface BreadcrumbItem {
  name: string;
  url: string;
}

export function buildBreadcrumbListJsonLd(
  items: readonly BreadcrumbItem[],
): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  });
}
