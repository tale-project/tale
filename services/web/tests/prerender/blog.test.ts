import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { publishedMarketingContent } from '../../lib/content/server';

const HERE = dirname(fileURLToPath(import.meta.url));
const articles = publishedMarketingContent().filter(
  (page) => page.category === 'blog',
);

describe('prerendered blog', () => {
  it('publishes the index and all ten guides as complete locale clusters', () => {
    expect(articles).toHaveLength(33);
  });
  for (const page of articles) {
    it(`${page.url} includes readable content, local media and truthful article metadata`, () => {
      const dom = new JSDOM(
        readFileSync(
          join(HERE, '../../dist', page.url.slice(1), 'index.html'),
          'utf8',
        ),
      );
      try {
        const document = dom.window.document;
        if (page.slug === 'index') {
          expect(document.querySelectorAll('main picture')).toHaveLength(10);
          for (const article of articles.filter(
            (entry) => entry.locale === page.locale && entry.slug !== 'index',
          )) {
            expect(
              document.querySelector(`main a[href="${article.url}"]`),
            ).not.toBeNull();
          }
        } else {
          const posting = [
            ...document.querySelectorAll('script[type="application/ld+json"]'),
          ]
            .map((script) => JSON.parse(script.textContent ?? '{}'))
            .find((schema) => schema['@type'] === 'BlogPosting');
          expect(posting?.headline).toBe(page.frontmatter.title);
          expect(posting?.author).toEqual({
            '@type': 'Organization',
            name: 'Tale',
            url: 'https://tale.dev',
          });
          expect(posting?.datePublished).toBeUndefined();
          expect(posting?.dateModified).toBeUndefined();
          expect(posting?.image).toContain(
            `/blog/covers/${page.frontmatter.topicId}-1200.webp`,
          );
          const hero = document.querySelector('main picture img');
          expect(hero?.getAttribute('alt')).toBe(page.frontmatter.coverAlt);
          expect(hero?.getAttribute('loading')).toBe('eager');
          expect(
            document.querySelector('article img')?.getAttribute('src'),
          ).toBe(
            `/blog/diagrams/${page.locale}/${page.frontmatter.topicId}-diagram.svg`,
          );
          expect(
            document.querySelectorAll('article table').length,
          ).toBeGreaterThan(0);
          expect(
            document.querySelectorAll(
              `article a[href^="/blog/worksheets/${page.locale}/"]`,
            ).length,
          ).toBeGreaterThan(0);
        }
      } finally {
        dom.window.close();
      }
    });
  }
});
