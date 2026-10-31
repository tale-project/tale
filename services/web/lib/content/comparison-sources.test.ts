import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { describe, expect, it } from 'vitest';

import { readMarketingContent } from './server';

/**
 * Comparison guides whose competitor claims have been checked against deep
 * primary sources (#4127). Each links no competitor homepage or repository
 * root and cites the same sources in every locale. Add a slug once its page
 * meets that bar in every locale; when every guide is listed, the list can go.
 */
const SOURCED_GUIDES = [
  'tale-vs-flowise',
  'tale-vs-vellum',
  'tale-vs-vibe-kanban',
] as const;

const REVIEW_DATE_LOCALES = { en: 'en-GB', de: 'de-DE', fr: 'fr-FR' } as const;
const TALE_HOSTS = new Set(['tale.dev', 'docs.tale.dev']);
const GITHUB_HOSTS = new Set(['github.com', 'www.github.com']);

const comparisons = readMarketingContent().filter(
  (page) => page.category === 'comparisons',
);
const guides = comparisons.filter((page) =>
  (SOURCED_GUIDES as readonly string[]).includes(page.slug),
);

/** Every link destination, read with the renderer's own Markdown parser. */
function links(content: string): string[] {
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
  return destinations;
}

/**
 * A site, locale or docs root, or a repository root (also at a branch),
 * names no page that backs a claim.
 */
function isRootOnly(href: string): boolean {
  const url = new URL(href);
  const segments = url.pathname.split('/').filter(Boolean);
  if (GITHUB_HOSTS.has(url.hostname)) {
    return (
      segments.length <= 2 || (segments[2] === 'tree' && segments.length <= 4)
    );
  }
  return (
    segments.length === 0 ||
    (segments.length === 1 &&
      /^(?:docs|(?:en|de|fr)(?:-[a-z]{2})?)$/i.test(segments[0]!))
  );
}

function externalLinks(content: string): string[] {
  return links(content).filter(
    (href) => /^https?:/.test(href) && !TALE_HOSTS.has(new URL(href).hostname),
  );
}

/** The review date as each locale writes it; French writes the 1st as 1er. */
function spelledDate(
  isoDate: string,
  locale: keyof typeof REVIEW_DATE_LOCALES,
) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  const spelled = date.toLocaleDateString(REVIEW_DATE_LOCALES[locale], {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return locale === 'fr' ? spelled.replace(/^1 /, '1er ') : spelled;
}

describe('sourced comparison guides', () => {
  it('covers every listed guide in every locale', () => {
    expect(guides.map((page) => `${page.locale}/${page.slug}`).sort()).toEqual(
      SOURCED_GUIDES.flatMap((slug) =>
        Object.keys(REVIEW_DATE_LOCALES).map((locale) => `${locale}/${slug}`),
      ).sort(),
    );
  });

  it('links no competitor homepage or repository root', () => {
    for (const page of guides) {
      const external = externalLinks(page.content);
      expect(external.length, page.url).toBeGreaterThan(0);
      expect(external.filter(isRootOnly), page.url).toEqual([]);
    }
  });

  it('cites the same sources in every locale', () => {
    for (const slug of SOURCED_GUIDES) {
      const [english, ...others] = (['en', 'de', 'fr'] as const).map(
        (locale) => {
          const page = guides.find(
            (guide) => guide.slug === slug && guide.locale === locale,
          );
          return [...new Set(externalLinks(page?.content ?? ''))].sort();
        },
      );
      for (const sources of others) expect(sources, slug).toEqual(english);
    }
  });
});

describe('every comparison page', () => {
  // The header renders the frontmatter date; the body's disclosure that the
  // page rests on public documentation, not a benchmark, gives the same one.
  it('states the frontmatter review date in the body', () => {
    for (const page of comparisons) {
      expect(page.content, page.url).toContain(
        spelledDate(page.frontmatter.reviewed, page.locale),
      );
    }
  });
});
