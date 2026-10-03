import { expect, test } from '@playwright/test';

import { readMarketingContent } from '../../../lib/content/server';

const content = readMarketingContent();
test.use({ contextOptions: { reducedMotion: 'reduce' } });

for (const locale of ['en', 'de', 'fr'] as const) {
  for (const width of [320, 1440]) {
    test(`${locale} marketing guides remain readable and correctly indexed at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const pages = content.filter(
        (contentDocument) =>
          contentDocument.locale === locale &&
          [
            '/compare',
            '/compare/tale-vs-dust',
            '/use-cases',
            '/use-cases/marketing-campaigns',
          ].includes(contentDocument.path),
      );
      expect(pages).toHaveLength(4);
      for (const contentDocument of pages) {
        await page.goto(contentDocument.url);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(
          contentDocument.frontmatter.title,
        );
        await expect(page.locator('link[rel=canonical]')).toHaveAttribute(
          'href',
          `https://tale.dev${contentDocument.url}`,
        );
        if (contentDocument.frontmatter.draft) {
          await expect(page.locator('meta[name=robots]')).toHaveAttribute(
            'content',
            'noindex,nofollow',
          );
          await expect(page.locator('link[hreflang]')).toHaveCount(0);
        } else {
          await expect(page.locator('link[hreflang]')).toHaveCount(5);
          await expect(page.locator('link[hreflang=fr]')).toHaveAttribute(
            'href',
            `https://tale.dev/fr${contentDocument.path}`,
          );
        }
        await page.evaluate(() => document.fonts.ready);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width);
        for (const cell of await page.locator('main td, main th').all()) {
          expect(
            await cell.evaluate(
              (element) => element.scrollWidth <= element.clientWidth + 1,
            ),
          ).toBe(true);
        }
        const localLinks = await page
          .locator('article a[href^="/"]')
          .evaluateAll((elements) =>
            elements.map((element) => element.getAttribute('href')),
          );
        for (const href of localLinks) {
          if (locale !== 'en')
            expect(href).toMatch(new RegExp(`^/${locale}(?:/|$)`));
        }
      }
    });
  }
}

test('a comparison links to its relevant use case and unknown slugs recover', async ({
  page,
}) => {
  await page.goto('/compare/tale-vs-dust');
  const next = page
    .locator('main a[href="/use-cases/marketing-campaigns"]')
    .first();
  await next.click();
  await expect(page).toHaveURL('/use-cases/marketing-campaigns');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await page.goto('/compare/tale-vs-not-a-published-product');
  await expect(page.locator('meta[name=robots]')).toHaveAttribute(
    'content',
    'noindex,nofollow',
  );
  await expect(page.locator('main a[href="/"]').first()).toBeVisible();
});
