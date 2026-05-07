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
  searchUrlTemplate?: string;
}

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
  imageUrl?: string;
  inLanguage?: string;
}

export function buildArticleJsonLd(params: ArticleParams): string {
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
    ...(params.publisherName
      ? { publisher: { '@type': 'Organization', name: params.publisherName } }
      : {}),
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
