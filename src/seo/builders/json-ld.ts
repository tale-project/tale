/**
 * Builders for the JSON-LD blocks Tale emits. Each function returns a
 * stringified object ready to drop inside a
 * `<script type="application/ld+json">` tag.
 */

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------

export interface OrganizationAddress {
  streetAddress: string;
  postalCode: string;
  addressLocality: string;
  /** ISO 3166-1 alpha-2 country code, e.g. `CH`. */
  addressCountry: string;
}

interface OrganizationParams {
  name: string;
  url: string;
  /** Stable node id (`@id`) so other blocks can reference this entity. */
  id?: string;
  /** Registered company name when it differs from the brand, e.g. `Ruler GmbH`. */
  legalName?: string;
  /** VAT registration, e.g. `CHE-186.532.610`. */
  vatID?: string;
  address?: OrganizationAddress;
  logoUrl?: string;
  sameAs?: readonly string[];
}

/**
 * `Organization` block — used on the homepage so Google can surface a
 * richer knowledge-panel result (logo, social profiles, legal entity).
 *
 * @example
 *   buildOrganizationJsonLd({
 *     name: 'Tale',
 *     url: 'https://tale.dev',
 *     legalName: 'Ruler GmbH',
 *     logoUrl: 'https://tale.dev/logo.png',
 *     sameAs: ['https://x.com/taledev', 'https://github.com/tale'],
 *   });
 */
export function buildOrganizationJsonLd(params: OrganizationParams): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Organization',
    ...(params.id ? { '@id': params.id } : {}),
    name: params.name,
    url: params.url,
    ...(params.legalName ? { legalName: params.legalName } : {}),
    ...(params.vatID ? { vatID: params.vatID } : {}),
    ...(params.address
      ? {
          address: {
            '@type': 'PostalAddress',
            streetAddress: params.address.streetAddress,
            postalCode: params.address.postalCode,
            addressLocality: params.address.addressLocality,
            addressCountry: params.address.addressCountry,
          },
        }
      : {}),
    ...(params.logoUrl ? { logo: params.logoUrl } : {}),
    ...(params.sameAs && params.sameAs.length > 0
      ? { sameAs: [...params.sameAs] }
      : {}),
  });
}

// ---------------------------------------------------------------------------
// WebSite (with optional sitelinks search action)
// ---------------------------------------------------------------------------

interface WebSiteParams {
  name: string;
  url: string;
  /**
   * Full URL template Google will hit when a user submits the sitelinks
   * search box. Must include the literal token `{search_term_string}`.
   * Typical value: `${siteUrl}/?q={search_term_string}`.
   */
  searchUrlTemplate?: string;
}

/**
 * `WebSite` block. When `searchUrlTemplate` is provided, a
 * `potentialAction.SearchAction` is attached so Google may render a
 * sitelinks search box.
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

// ---------------------------------------------------------------------------
// Article
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// FAQPage
// ---------------------------------------------------------------------------

export interface FaqEntry {
  question: string;
  answer: string;
}

/**
 * `FAQPage` block. Emit only for questions whose answers are visibly
 * rendered on the page — schema for invisible content invites a manual
 * action. Answers are plain text (`acceptedAnswer.text`).
 *
 * @example
 *   buildFaqPageJsonLd([
 *     { question: 'Is Tale open source?', answer: 'Yes — MIT licensed.' },
 *   ]);
 */
export function buildFaqPageJsonLd(entries: readonly FaqEntry[]): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: entries.map((entry) => ({
      '@type': 'Question',
      name: entry.question,
      acceptedAnswer: { '@type': 'Answer', text: entry.answer },
    })),
  });
}

// ---------------------------------------------------------------------------
// SoftwareApplication
// ---------------------------------------------------------------------------

export interface SoftwareOffer {
  /** Display name of the edition/plan, e.g. `Community`, `Enterprise`. */
  name: string;
  /** Numeric price as a string, e.g. `'0'`, `'12'`. */
  price: string;
  /** ISO 4217 currency, e.g. `CHF`. */
  priceCurrency: string;
  /**
   * Billing unit for recurring per-seat pricing, e.g. `per user per month`.
   * When set, the offer carries a `UnitPriceSpecification`.
   */
  unitText?: string;
}

interface SoftwareApplicationParams {
  name: string;
  url: string;
  description: string;
  /** Stable node id (`@id`) so the same entity can be re-declared per page. */
  id?: string;
  /** schema.org category, e.g. `BusinessApplication`. */
  applicationCategory: string;
  /** Free-form OS/runtime line, e.g. `Linux (Docker, self-hosted)`. */
  operatingSystem: string;
  /** URL of the license text, e.g. the repository's MIT LICENSE. */
  licenseUrl?: string;
  inLanguage?: readonly string[];
  sameAs?: readonly string[];
  offers?: readonly SoftwareOffer[];
}

/**
 * `SoftwareApplication` block describing the product itself. Offers must
 * mirror the prices rendered on the page — source them from the same
 * constants the pricing UI uses so the two can't drift.
 */
export function buildSoftwareApplicationJsonLd(
  params: SoftwareApplicationParams,
): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    ...(params.id ? { '@id': params.id } : {}),
    name: params.name,
    url: params.url,
    description: params.description,
    applicationCategory: params.applicationCategory,
    operatingSystem: params.operatingSystem,
    ...(params.licenseUrl ? { license: params.licenseUrl } : {}),
    ...(params.inLanguage && params.inLanguage.length > 0
      ? { inLanguage: [...params.inLanguage] }
      : {}),
    ...(params.sameAs && params.sameAs.length > 0
      ? { sameAs: [...params.sameAs] }
      : {}),
    ...(params.offers && params.offers.length > 0
      ? {
          offers: params.offers.map((offer) => ({
            '@type': 'Offer',
            name: offer.name,
            price: offer.price,
            priceCurrency: offer.priceCurrency,
            ...(offer.unitText
              ? {
                  priceSpecification: {
                    '@type': 'UnitPriceSpecification',
                    price: offer.price,
                    priceCurrency: offer.priceCurrency,
                    unitText: offer.unitText,
                  },
                }
              : {}),
          })),
        }
      : {}),
  });
}

// ---------------------------------------------------------------------------
// BreadcrumbList
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// ItemList
// ---------------------------------------------------------------------------

export interface ItemListEntry {
  name: string;
  url: string;
  /** ISO 8601 date when the listed item was published, if known. */
  datePublished?: string;
}

/**
 * `ItemList` block for visible ordered collections (changelog releases,
 * compare hubs, etc.). Emit only for items rendered on the page.
 *
 * Each entry nests its subject under `ListItem.item` rather than putting
 * `name` / `url` / `datePublished` on the `ListItem` itself. `ListItem` is
 * an `Intangible`, so it has no `datePublished` — that property is defined
 * on `CreativeWork`, and emitting it directly on the `ListItem` is a
 * schema.org validation error. The nested form is also one of the two
 * shapes Google documents for `ItemList`.
 */
export function buildItemListJsonLd(
  items: readonly ItemListEntry[],
  opts?: { name?: string },
): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    ...(opts?.name ? { name: opts.name } : {}),
    numberOfItems: items.length,
    itemListElement: items.map((entry, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'CreativeWork',
        name: entry.name,
        url: entry.url,
        ...(entry.datePublished ? { datePublished: entry.datePublished } : {}),
      },
    })),
  });
}
