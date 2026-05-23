import { describe, expect, it } from 'vitest';

import {
  buildArticleJsonLd,
  buildBreadcrumbListJsonLd,
  buildOrganizationJsonLd,
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
