import { describe, expect, it } from 'vitest';

import {
  buildArticleJsonLd,
  buildBreadcrumbListJsonLd,
  buildFaqPageJsonLd,
  buildItemListJsonLd,
  buildOrganizationJsonLd,
  buildSoftwareApplicationJsonLd,
  buildWebSiteJsonLd,
} from './json-ld';

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonObjectArray(
  value: unknown,
): value is Array<Record<string, unknown>> {
  return Array.isArray(value) && value.every(isJsonObject);
}

function parse(json: string): Record<string, unknown> {
  const value: unknown = JSON.parse(json);
  if (!isJsonObject(value)) {
    throw new Error(`Expected JSON object, got ${typeof value}`);
  }
  return value;
}

describe('buildOrganizationJsonLd', () => {
  it('emits the canonical Organization shape', () => {
    const parsed = parse(
      buildOrganizationJsonLd({ name: 'Tale', url: 'https://tale.dev' }),
    );
    expect(parsed['@context']).toBe('https://schema.org');
    expect(parsed['@type']).toBe('Organization');
    expect(parsed.name).toBe('Tale');
    expect(parsed.url).toBe('https://tale.dev');
    expect(parsed.logo).toBeUndefined();
  });

  it('includes optional logo and sameAs when provided', () => {
    const parsed = parse(
      buildOrganizationJsonLd({
        name: 'Tale',
        url: 'https://tale.dev',
        logoUrl: 'https://tale.dev/logo.png',
        sameAs: ['https://x.com/tale'],
      }),
    );
    expect(parsed.logo).toBe('https://tale.dev/logo.png');
    expect(parsed.sameAs).toEqual(['https://x.com/tale']);
  });

  it('includes the legal-entity fields when provided', () => {
    const parsed = parse(
      buildOrganizationJsonLd({
        name: 'Tale',
        url: 'https://tale.dev',
        id: 'https://tale.dev/#org',
        legalName: 'Ruler GmbH',
        vatID: 'CHE-186.532.610',
        address: {
          streetAddress: 'Seestrasse 4',
          postalCode: '3700',
          addressLocality: 'Spiez',
          addressCountry: 'CH',
        },
      }),
    );
    expect(parsed['@id']).toBe('https://tale.dev/#org');
    expect(parsed.legalName).toBe('Ruler GmbH');
    expect(parsed.vatID).toBe('CHE-186.532.610');
    expect(parsed.address).toEqual({
      '@type': 'PostalAddress',
      streetAddress: 'Seestrasse 4',
      postalCode: '3700',
      addressLocality: 'Spiez',
      addressCountry: 'CH',
    });
  });
});

describe('buildFaqPageJsonLd', () => {
  it('emits one Question/Answer pair per entry', () => {
    const parsed = parse(
      buildFaqPageJsonLd([
        { question: 'Is Tale open source?', answer: 'Yes — MIT licensed.' },
        { question: 'Can it run air-gapped?', answer: 'Yes.' },
      ]),
    );
    expect(parsed['@type']).toBe('FAQPage');
    if (!isJsonObjectArray(parsed.mainEntity)) {
      throw new Error('Expected mainEntity array');
    }
    expect(parsed.mainEntity).toHaveLength(2);
    expect(parsed.mainEntity[0]['@type']).toBe('Question');
    expect(parsed.mainEntity[0].name).toBe('Is Tale open source?');
    expect(parsed.mainEntity[0].acceptedAnswer).toEqual({
      '@type': 'Answer',
      text: 'Yes — MIT licensed.',
    });
  });
});

describe('buildSoftwareApplicationJsonLd', () => {
  const base = {
    name: 'Tale',
    url: 'https://tale.dev',
    description: 'The orchestrator for AI agents.',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Linux (Docker, self-hosted)',
  };

  it('emits the canonical SoftwareApplication shape', () => {
    const parsed = parse(buildSoftwareApplicationJsonLd(base));
    expect(parsed['@type']).toBe('SoftwareApplication');
    expect(parsed.applicationCategory).toBe('BusinessApplication');
    expect(parsed.offers).toBeUndefined();
    expect(parsed.license).toBeUndefined();
  });

  it('emits offers with a UnitPriceSpecification for per-seat pricing', () => {
    const parsed = parse(
      buildSoftwareApplicationJsonLd({
        ...base,
        id: 'https://tale.dev/#software',
        licenseUrl: 'https://github.com/tale-project/tale/blob/main/LICENSE',
        offers: [
          { name: 'Community', price: '0', priceCurrency: 'CHF' },
          {
            name: 'Enterprise',
            price: '12',
            priceCurrency: 'CHF',
            unitText: 'per user per month',
          },
        ],
      }),
    );
    expect(parsed['@id']).toBe('https://tale.dev/#software');
    if (!isJsonObjectArray(parsed.offers)) {
      throw new Error('Expected offers array');
    }
    expect(parsed.offers[0]).toEqual({
      '@type': 'Offer',
      name: 'Community',
      price: '0',
      priceCurrency: 'CHF',
    });
    expect(parsed.offers[1].priceSpecification).toEqual({
      '@type': 'UnitPriceSpecification',
      price: '12',
      priceCurrency: 'CHF',
      unitText: 'per user per month',
    });
  });
});

describe('buildWebSiteJsonLd', () => {
  it('emits a plain WebSite when no search template is given', () => {
    const parsed = parse(
      buildWebSiteJsonLd({ name: 'Tale', url: 'https://tale.dev' }),
    );
    expect(parsed['@type']).toBe('WebSite');
    expect(parsed.potentialAction).toBeUndefined();
  });

  it('attaches a SearchAction when a search template is given', () => {
    const parsed = parse(
      buildWebSiteJsonLd({
        name: 'Tale',
        url: 'https://tale.dev',
        searchUrlTemplate: 'https://tale.dev/?q={search_term_string}',
      }),
    ) as { potentialAction?: Record<string, unknown> };
    expect(parsed.potentialAction).toBeDefined();
    expect(parsed.potentialAction?.['@type']).toBe('SearchAction');
  });
});

describe('buildArticleJsonLd', () => {
  it('marshals optional Article fields when provided', () => {
    const parsed = parse(
      buildArticleJsonLd({
        headline: 'Hello',
        description: 'World.',
        url: 'https://tale.dev/posts/hello',
        datePublished: '2024-01-02',
        dateModified: '2024-01-03',
        authorName: 'Ruler',
        publisherName: 'Tale',
        publisherLogoUrl: 'https://tale.dev/logo.png',
        imageUrl: 'https://tale.dev/cover.jpg',
        inLanguage: 'en',
      }),
    );
    expect(parsed['@type']).toBe('Article');
    expect(parsed.datePublished).toBe('2024-01-02');
    expect(parsed.author).toEqual({ '@type': 'Organization', name: 'Ruler' });
    expect(parsed.publisher).toMatchObject({
      '@type': 'Organization',
      name: 'Tale',
    });
  });
});

describe('buildBreadcrumbListJsonLd', () => {
  it('emits items with 1-based positions', () => {
    const parsed = parse(
      buildBreadcrumbListJsonLd([
        { name: 'Home', url: 'https://tale.dev/' },
        { name: 'Pricing', url: 'https://tale.dev/pricing' },
      ]),
    );
    if (!isJsonObjectArray(parsed.itemListElement)) {
      throw new Error('Expected itemListElement to be an array of objects');
    }
    expect(parsed.itemListElement).toHaveLength(2);
    expect(parsed.itemListElement[0].position).toBe(1);
    expect(parsed.itemListElement[1].position).toBe(2);
  });
});

describe('buildItemListJsonLd', () => {
  it('emits a numbered ItemList with optional dates', () => {
    const parsed = parse(
      buildItemListJsonLd(
        [
          {
            name: 'v1.0.0',
            url: 'https://github.com/tale-project/tale/releases/tag/v1.0.0',
            datePublished: '2026-01-02',
          },
          {
            name: 'v0.9.0',
            url: 'https://github.com/tale-project/tale/releases/tag/v0.9.0',
          },
        ],
        { name: "What's new in Tale?" },
      ),
    );
    expect(parsed['@type']).toBe('ItemList');
    expect(parsed.name).toBe("What's new in Tale?");
    expect(parsed.numberOfItems).toBe(2);
    if (!isJsonObjectArray(parsed.itemListElement)) {
      throw new Error('Expected itemListElement to be an array of objects');
    }
    expect(parsed.itemListElement[0]).toMatchObject({
      '@type': 'ListItem',
      position: 1,
      item: {
        '@type': 'CreativeWork',
        name: 'v1.0.0',
        url: 'https://github.com/tale-project/tale/releases/tag/v1.0.0',
        datePublished: '2026-01-02',
      },
    });

    const second = parsed.itemListElement[1].item;
    if (!isJsonObject(second)) {
      throw new Error('Expected the second entry to nest an item object');
    }
    expect(second.datePublished).toBeUndefined();
    expect(second.name).toBe('v0.9.0');
  });

  // Regression: `datePublished` is a CreativeWork property. Emitting it on
  // the ListItem itself made every changelog locale fail schema.org
  // validation (Ahrefs: "Structured data has schema.org validation error").
  it('keeps datePublished off the ListItem itself', () => {
    const parsed = parse(
      buildItemListJsonLd([
        {
          name: 'v1.0.0',
          url: 'https://example.test/v1',
          datePublished: '2026-01-02',
        },
      ]),
    );
    if (!isJsonObjectArray(parsed.itemListElement)) {
      throw new Error('Expected itemListElement to be an array of objects');
    }
    const [first] = parsed.itemListElement;
    expect(first.datePublished).toBeUndefined();
    expect(first.name).toBeUndefined();
    expect(first.url).toBeUndefined();
  });
});
