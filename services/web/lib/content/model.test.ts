import { describe, expect, it } from 'vitest';

import { marketingContentHeading, visibleMarketingContent } from './model';
import { parseMarketingContent } from './parse';
import { readMarketingContent } from './server';

const fixture = `---
title: Compare Tale and a sample workspace
description: Compare how Tale and this sample workspace organize project work, delegate tasks to agents, and review the results together.
slug: tale-vs-example
competitor: Example
relationship: direct
reviewed: '2026-10-03'
draft: true
---

## Decide how your team reviews work

Evaluate one concrete project together.
`;

function page(locale: 'en' | 'de' | 'fr', draft = true) {
  return parseMarketingContent(
    fixture.replace('draft: true', `draft: ${draft}`),
    `/content/comparisons/${locale}/tale-vs-example.md`,
  );
}

describe('marketing content boundary', () => {
  it('omits only the trailing site suffix from visible headings', () => {
    expect(
      marketingContentHeading('AI agents for marketing teams | Tale'),
    ).toBe('AI agents for marketing teams');
    expect(marketingContentHeading('Tale | Team workflows')).toBe(
      'Tale | Team workflows',
    );
    expect(marketingContentHeading('Projekte gemeinsam planen')).toBe(
      'Projekte gemeinsam planen',
    );
  });
  it('parses YAML with validated identity, metadata, body and localized paths', () => {
    const document = page('de');
    expect(document.path).toBe('/compare/tale-vs-example');
    expect(document.url).toBe('/de/compare/tale-vs-example');
    expect(document.frontmatter.competitor).toBe('Example');
    expect(document.content.startsWith('## Decide')).toBe(true);
  });

  it('rejects unknown locales, path traversal, mismatched slugs, invalid dates and extra H1s', () => {
    for (const path of [
      '/content/comparisons/es/tale-vs-example.md',
      '/content/comparisons/en/../example.md',
    ]) {
      expect(() => parseMarketingContent(fixture, path)).toThrow();
    }
    for (const raw of [
      fixture.replace('slug: tale-vs-example', 'slug: other'),
      fixture.replace('2026-10-03', '2026-02-31'),
      fixture.replace('## Decide', '# Decide'),
      fixture.replace('draft: true', 'draft: yes'),
    ]) {
      expect(() =>
        parseMarketingContent(
          raw,
          '/content/comparisons/en/tale-vs-example.md',
        ),
      ).toThrow();
    }
  });

  it('keeps drafts and incomplete locale clusters out of discovery', () => {
    expect(
      visibleMarketingContent([page('en'), page('de'), page('fr')]),
    ).toEqual([]);
    expect(
      visibleMarketingContent([
        page('en', false),
        page('de', false),
        page('fr'),
      ]),
    ).toEqual([]);
    expect(
      visibleMarketingContent([page('en', false), page('de', false)]),
    ).toEqual([]);
    expect(
      visibleMarketingContent([page('en'), page('de')], {
        includeDrafts: true,
      }),
    ).toHaveLength(2);
    expect(
      visibleMarketingContent([
        page('en', false),
        page('de', false),
        page('fr', false),
      ]),
    ).toHaveLength(3);
  });

  it('marks every preview-only variant as an effective draft without changing source flags', () => {
    const source = [page('en', false), page('de', false), page('fr')];
    const preview = visibleMarketingContent(source, { includeDrafts: true });
    expect(preview).toHaveLength(3);
    expect(preview.every((entry) => entry.frontmatter.draft)).toBe(true);
    expect(source.map((entry) => entry.frontmatter.draft)).toEqual([
      false,
      false,
      true,
    ]);
    expect(visibleMarketingContent(source)).toEqual([]);
  });

  it('validates the whole handoff with matching locale identities and unique metadata', () => {
    const pages = readMarketingContent();
    const english = pages.filter((entry) => entry.locale === 'en');
    expect(english.length).toBeGreaterThan(0);
    for (const locale of ['en', 'de', 'fr']) {
      const localized = pages.filter((entry) => entry.locale === locale);
      expect(localized).toHaveLength(english.length);
      expect(
        new Set(localized.map((entry) => entry.frontmatter.title)).size,
      ).toBe(english.length);
      expect(
        new Set(localized.map((entry) => entry.frontmatter.description)).size,
      ).toBe(english.length);
      expect(localized.map((entry) => entry.path).sort()).toEqual(
        english.map((entry) => entry.path).sort(),
      );
    }
  });
});
