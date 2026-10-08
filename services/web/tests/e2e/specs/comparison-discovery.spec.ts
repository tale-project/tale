import { expect, test } from '@playwright/test';
import { createI18n } from '@tale/e2e/i18n';

import { publishedMarketingContent } from '../../../lib/content/server';
import { gotoClientPage } from '../helpers/client-page';

const guides = publishedMarketingContent().filter(
  (page) => page.category === 'comparisons' && page.slug !== 'index',
);
test.use({ contextOptions: { reducedMotion: 'reduce' } });

for (const locale of ['en', 'de', 'fr'] as const) {
  const { t } = createI18n(
    new URL(`../../../messages/${locale}.yml`, import.meta.url),
  );
  const prefix = locale === 'en' ? '' : `/${locale}`;
  const pages = guides.filter((page) => page.locale === locale);
  const resultCount = (count: number) =>
    t('contentPages.comparisons.resultCount')
      .replace('{count}', String(count))
      .replace('{total}', String(pages.length));
  for (const width of [320, 1440]) {
    test(`${locale} comparison discovery searches, filters, resets and opens a localized guide at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await gotoClientPage(page, `${prefix}/compare`);
      const directory = page.getByRole('region', {
        name: t('contentPages.comparisons.directoryTitle'),
      });
      const search = directory.getByRole('textbox', {
        name: t('contentPages.comparisons.searchLabel'),
      });
      const links = directory.getByRole('link');
      await expect(links).toHaveCount(pages.length);
      await expect(directory.getByRole('status')).toHaveText(
        resultCount(pages.length),
      );

      const frameworks = pages.filter(
        (entry) => entry.frontmatter.relationship === 'framework',
      );
      const filter = directory.getByRole('button', {
        name: t('contentPages.comparisons.types.framework.label'),
        exact: true,
      });
      await filter.click();
      await expect(filter).toHaveAttribute('aria-pressed', 'true');
      await expect(links).toHaveCount(frameworks.length);
      expect(
        await links.evaluateAll((elements) =>
          elements
            .map((element) => element.getAttribute('href'))
            .sort((left, right) => (left ?? '').localeCompare(right ?? '')),
        ),
      ).toEqual(frameworks.map((entry) => entry.url).sort());

      await search.click();
      await search.fill('langgraph');
      await expect(links).toHaveCount(1);
      await expect(links).toHaveAttribute(
        'href',
        `${prefix}/compare/tale-vs-langgraph`,
      );
      await expect(directory.getByRole('status')).toHaveText(resultCount(1));
      await search.fill('no-product-matches-this-search');
      await expect(links).toHaveCount(0);
      await expect(
        directory.getByRole('heading', {
          name: t('contentPages.comparisons.emptyTitle'),
        }),
      ).toBeVisible();
      await directory
        .getByRole('button', {
          name: t('contentPages.comparisons.reset'),
          exact: true,
        })
        .click();
      await expect(search).toBeFocused();
      await expect(search).toHaveValue('');
      await expect(links).toHaveCount(pages.length);
      await expect(
        directory.getByRole('button', {
          name: t('contentPages.comparisons.types.all.label'),
          exact: true,
        }),
      ).toHaveAttribute('aria-pressed', 'true');
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);

      await search.fill('  OPENCLAW  ');
      await expect(links).toHaveCount(1);
      await search.press('Tab');
      await page.keyboard.press('Enter');
      await expect(
        directory.getByRole('button', {
          name: t('contentPages.comparisons.types.all.label'),
          exact: true,
        }),
      ).toHaveAttribute('aria-pressed', 'true');
      await links.click();
      await expect(page).toHaveURL(`${prefix}/compare/tale-vs-openclaw`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect(page.getByRole('table')).toHaveCount(1);
    });
  }
}
