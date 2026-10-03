import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MarketingRouterProvider } from '@tale/marketing-ui/routing';
import type { MarketingLinkComponentProps } from '@tale/marketing-ui/routing';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BlogArticles } from '@/app/components/blocks/blog-articles';
import { BLOG_RELATED_TOPICS } from '@/app/content/blog-relationships';
import { BLOG_DIAGRAM_MANIFEST } from '@/app/generated/blog-diagram-manifest';
import { BLOG_IMAGE_MANIFEST } from '@/app/generated/blog-image-manifest';

import { parseMarketingContent } from './parse';
import { readMarketingContent } from './server';

const HERE = dirname(fileURLToPath(import.meta.url));
const articles = readMarketingContent().filter(
  (page) => page.category === 'blog' && page.slug !== 'index',
);
const publicFile = (path: string) => join(HERE, '../../public', path.slice(1));
function PlainLink({
  to,
  children,
  activeProps: _activeProps,
  ...props
}: MarketingLinkComponentProps) {
  return (
    <a href={to} {...props}>
      {children}
    </a>
  );
}

describe('blog content and media contract', () => {
  it('ships ten complete, distinct guides and equivalent localized structures', () => {
    expect(articles).toHaveLength(30);
    const english = articles.filter((page) => page.locale === 'en');
    expect(new Set(english.map((page) => page.frontmatter.topicId)).size).toBe(
      10,
    );
    for (const source of english) {
      const variants = articles.filter((page) => page.slug === source.slug);
      expect(variants.map((page) => page.locale).sort()).toEqual([
        'de',
        'en',
        'fr',
      ]);
      for (const page of variants) {
        expect(page.frontmatter.topicId).toBe(source.frontmatter.topicId);
        expect(page.content.match(/^## /gm)?.length).toBe(
          source.content.match(/^## /gm)?.length,
        );
        expect(page.content.match(/^\|/gm)?.length).toBe(
          source.content.match(/^\|/gm)?.length,
        );
        const diagram = BLOG_DIAGRAM_MANIFEST.find(
          (entry) =>
            entry.id === page.frontmatter.topicId &&
            entry.locale === page.locale,
        );
        expect(diagram, page.url).toBeDefined();
        expect(page.content, page.url).toContain(`](${diagram?.path})`);
        expect(page.content, page.url).not.toMatch(
          /\.\.\/\.\.\/(?:assets|templates)\//,
        );
        const worksheets = [
          ...page.content.matchAll(/\]\((\/blog\/worksheets\/[^)]+)\)/g),
        ];
        expect(worksheets.length, page.url).toBeGreaterThan(0);
        for (const [, path] of worksheets) {
          expect(path).toContain(`/worksheets/${page.locale}/`);
          expect(existsSync(publicFile(path)), path).toBe(true);
          const worksheet = readFileSync(publicFile(path), 'utf8');
          const englishWorksheet = readFileSync(
            publicFile(
              path.replace(`/worksheets/${page.locale}/`, '/worksheets/en/'),
            ),
            'utf8',
          );
          // A translated download must retain both the worked example and
          // the reusable fields; existence alone would accept a stub.
          expect(worksheet.match(/^## /gm)?.length, path).toBe(
            englishWorksheet.match(/^## /gm)?.length,
          );
          expect(worksheet.match(/^\|/gm)?.length, path).toBe(
            englishWorksheet.match(/^\|/gm)?.length,
          );
        }
        // Bibliographic sources must survive localization. Tale documentation
        // has equivalent localized URLs and is checked by lint:links.
        const citations = (body: string) =>
          [...body.matchAll(/\]\((https?:\/\/[^)]+)\)/g)]
            .map((match) => match[1])
            .filter((url) => !/^https:\/\/(?:docs\.)?tale\.dev\//.test(url))
            .sort();
        expect(citations(page.content), page.url).toEqual(
          citations(source.content),
        );
      }
    }
  });

  it('rejects blog articles without an explicit identity or meaningful image alternative', () => {
    const source = join(
      HERE,
      '../../app/content/blog/en/ai-agents-vs-workflow-automation.md',
    );
    const raw = readFileSync(source, 'utf8');
    for (const invalid of [
      raw.replace(/^topicId:.*\n/m, ''),
      raw.replace(/^coverAlt:.*\n/m, ''),
      raw.replace('topicId: T03', 'topicId: ../../secret'),
    ]) {
      expect(() => parseMarketingContent(invalid, source)).toThrow();
    }
  });

  it('has responsive cover files and localized diagram assets for every topic', () => {
    expect(BLOG_IMAGE_MANIFEST).toHaveLength(10);
    expect(BLOG_DIAGRAM_MANIFEST).toHaveLength(30);
    for (const image of BLOG_IMAGE_MANIFEST) {
      expect(image.width).toBeGreaterThan(0);
      expect(image.height).toBeGreaterThan(0);
      for (const variants of [image.variants.webp, image.variants.avif]) {
        for (const path of Object.values(variants))
          expect(existsSync(publicFile(path)), path).toBe(true);
      }
    }
    for (const diagram of BLOG_DIAGRAM_MANIFEST) {
      const svg = readFileSync(publicFile(diagram.path), 'utf8');
      expect(svg).toContain('<title');
      expect(svg).toContain('<desc');
      expect(svg).not.toMatch(/<script|<foreignObject|onload=/i);
    }
  });

  it('renders metadata-only cards for all localized articles and keeps related reading valid', () => {
    for (const locale of ['en', 'de', 'fr']) {
      const pages = articles.filter((page) => page.locale === locale);
      const html = renderToStaticMarkup(
        <MarketingRouterProvider link={PlainLink}>
          <BlogArticles pages={pages} />
        </MarketingRouterProvider>,
      );
      const document = new DOMParser().parseFromString(html, 'text/html');
      expect(
        [...document.querySelectorAll('a')].map((a) => a.getAttribute('href')),
      ).toEqual(pages.map((page) => page.path));
      expect(document.querySelectorAll('picture')).toHaveLength(10);
      expect(
        document.querySelectorAll('img[alt=""][width][height]'),
      ).toHaveLength(10);
      for (const page of pages) {
        const related =
          BLOG_RELATED_TOPICS[page.frontmatter.topicId ?? ''] ?? [];
        expect(related.length).toBeGreaterThan(0);
        expect(related).not.toContain(page.frontmatter.topicId);
        for (const topic of related)
          expect(
            pages.some((candidate) => candidate.frontmatter.topicId === topic),
          ).toBe(true);
      }
    }
  });
});
