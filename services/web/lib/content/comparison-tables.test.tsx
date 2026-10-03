import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { MarketingProse } from '@/app/components/marketing/marketing-prose';

import { readMarketingContent } from './server';

const comparisons = readMarketingContent().filter(
  (page) => page.category === 'comparisons' && page.slug !== 'index',
);
const criteria = { en: 'Criterion', de: 'Kriterium', fr: 'Critère' };

describe('comparison tables', () => {
  it('renders a substantive, named comparison for every product in every locale', () => {
    expect(comparisons.length).toBeGreaterThan(0);
    for (const page of comparisons) {
      const html = renderToStaticMarkup(
        <MarketingProse tableLabel={page.frontmatter.title}>
          {page.content}
        </MarketingProse>,
      );
      const document = new DOMParser().parseFromString(html, 'text/html');
      const tables = document.querySelectorAll('table');
      expect(tables.length, page.url).toBe(1);
      const table = tables[0]!;
      expect(table.caption?.textContent, page.url).toBe(page.frontmatter.title);
      expect(
        Array.from(table.querySelectorAll('thead th[scope="col"]')).map(
          (cell) => cell.textContent,
        ),
        page.url,
      ).toEqual([criteria[page.locale], 'Tale', page.frontmatter.competitor]);
      const rows = Array.from(table.querySelectorAll('tbody tr'));
      expect(rows.length, page.url).toBeGreaterThanOrEqual(3);
      for (const row of rows) {
        expect(row.children.length, page.url).toBe(3);
        for (const cell of row.children)
          expect(cell.textContent?.trim().length, page.url).toBeGreaterThan(0);
      }
      const region = table.parentElement!;
      expect(region.getAttribute('role'), page.url).toBe('region');
      expect(region.getAttribute('aria-label'), page.url).toBe(
        page.frontmatter.title,
      );
      expect(region.tabIndex, page.url).toBe(0);
    }
  }, 15_000);

  it('keeps comparison dimensions aligned across each product’s locales', () => {
    for (const english of comparisons.filter((page) => page.locale === 'en')) {
      const variants = comparisons.filter((page) => page.slug === english.slug);
      expect(variants.map((page) => page.locale).sort(), english.slug).toEqual([
        'de',
        'en',
        'fr',
      ]);
      const rowCounts = variants.map(
        (page) =>
          page.content.split('\n').filter((line) => line.startsWith('|'))
            .length,
      );
      expect(new Set(rowCounts).size, english.slug).toBe(1);
    }
  });
});
