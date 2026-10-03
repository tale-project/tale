import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { localizedPath, SUPPORTED_LOCALES } from '@tale/ui/i18n/locales';
import { TALE_SITE_URL } from '@tale/ui/seo/globals';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { describe, expect, it } from 'vitest';

import {
  COMPARISON_USE_CASES,
  PLATFORM_USE_CASES,
  USE_CASE_SLUGS,
} from '@/app/content/content-relationships';

import { LEGAL_SLUGS } from '../legal/slugs';
import { LOCALIZED_ROUTE_PATHS } from '../seo/route-paths';
import { readMarketingContent } from './server';

const HERE = dirname(fileURLToPath(import.meta.url));
const pages = readMarketingContent();
const knownUrls = new Set([
  ...pages.map((page) => page.url),
  ...SUPPORTED_LOCALES.flatMap((locale) => [
    ...LOCALIZED_ROUTE_PATHS.map((path) => localizedPath(locale, path)),
    ...LEGAL_SLUGS.map((slug) => localizedPath(locale, `/legal/${slug}`)),
  ]),
]);

/** Use the renderer's real Markdown/GFM parser, including table/reference
 * links. Regex-only extraction would silently miss valid Markdown links. */
function internalLinks(content: string, pageUrl: string): string[] {
  const destinations: string[] = [];
  renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      {
        remarkPlugins: [remarkGfm],
        urlTransform: (url, key) => {
          if (key === 'href') destinations.push(url);
          return url;
        },
      },
      content,
    ),
  );
  return destinations.flatMap((href) => {
    if (!href || href.startsWith('#')) return [];
    const url = new URL(href, `${TALE_SITE_URL}${pageUrl}`);
    // Documentation and competitor references have separate origins/routes.
    if (url.origin !== TALE_SITE_URL) return [];
    return [url.pathname.replace(/\/$/, '') || '/'];
  });
}

describe('marketing content source graph', () => {
  it('resolves every internal source link and preserves the source locale', () => {
    const failures: string[] = [];
    for (const page of pages) {
      const links = internalLinks(page.content, page.url);
      expect(links.length, `${page.url} needs a next step`).toBeGreaterThan(0);
      for (const target of links) {
        const worksheet =
          /^\/blog\/worksheets\/(en|de|fr)\/[A-Za-z0-9-]+\.md$/.exec(target);
        if (worksheet) {
          expect(worksheet[1], `${page.url} worksheet locale`).toBe(
            page.locale,
          );
          expect(
            existsSync(join(HERE, '../../public', target.slice(1))),
            target,
          ).toBe(true);
          continue;
        }
        if (!knownUrls.has(target))
          failures.push(`${page.url} → unknown ${target}`);
        const targetLocale = /^\/(de|fr)(?:\/|$)/.exec(target)?.[1] ?? 'en';
        if (targetLocale !== page.locale)
          failures.push(`${page.url} → wrong locale ${target}`);
      }
    }
    expect(failures).toEqual([]);
  }, 15_000);

  it('makes every localized comparison and use case reachable from its own hub', () => {
    for (const hub of pages.filter((page) => page.slug === 'index')) {
      // Blog cards are generated from validated metadata; blog.test.tsx and
      // the blog browser suite verify their rendered destinations.
      if (hub.category === 'blog') continue;
      const linked = new Set(internalLinks(hub.content, hub.url));
      const leaves = pages.filter(
        (page) =>
          page.category === hub.category &&
          page.locale === hub.locale &&
          page.slug !== 'index',
      );
      for (const leaf of leaves)
        expect(linked.has(leaf.url), `${hub.url} must link ${leaf.url}`).toBe(
          true,
        );
    }
  });

  it('maps every comparison to a valid localized use case without stale entries', () => {
    const comparisons = pages.filter(
      (page) =>
        page.category === 'comparisons' &&
        page.locale === 'en' &&
        page.slug !== 'index',
    );
    expect(Object.keys(COMPARISON_USE_CASES).sort()).toEqual(
      comparisons.map((page) => page.slug).sort(),
    );
    const useCases = pages.filter(
      (page) =>
        page.category === 'use-cases' &&
        page.locale === 'en' &&
        page.slug !== 'index',
    );
    expect([...USE_CASE_SLUGS].sort()).toEqual(
      useCases.map((page) => page.slug).sort(),
    );
    for (const slug of [
      ...Object.values(COMPARISON_USE_CASES),
      ...Object.values(PLATFORM_USE_CASES).flat(),
    ]) {
      for (const locale of SUPPORTED_LOCALES) {
        expect(
          knownUrls.has(localizedPath(locale, `/use-cases/${slug}`)),
          `${locale} related use case ${slug}`,
        ).toBe(true);
      }
    }
  });
});
