import { expect, test } from '@playwright/test';

import { readMarketingContent } from '../../../lib/content/server';

const content = readMarketingContent();
test.use({ contextOptions: { reducedMotion: 'reduce' } });

for (const locale of ['en', 'de', 'fr'] as const) {
  test(`${locale} homepage introduces relevant use cases`, async ({ page }) => {
    const prefix = locale === 'en' ? '' : `/${locale}`;
    await page.goto(prefix || '/');
    for (const slug of [
      'marketing-campaigns',
      'software-development',
      'operations',
    ]) {
      const link = page.locator(`main a[href="${prefix}/use-cases/${slug}"]`);
      await expect(link).toHaveCount(1);
      await link.scrollIntoViewIfNeeded();
      await expect(link).toBeVisible();
    }
    await page
      .locator(`main a[href="${prefix}/use-cases/marketing-campaigns"]`)
      .click();
    await expect(page).toHaveURL(`${prefix}/use-cases/marketing-campaigns`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  });

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
          contentDocument.frontmatter.title.replace(/ \| Tale$/, ''),
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
        if (contentDocument.frontmatter.competitor) {
          const table = page.getByRole('table', {
            name: contentDocument.frontmatter.title,
            exact: true,
          });
          await expect(table).toHaveCount(1);
          await expect(table.getByRole('columnheader')).toHaveCount(3);
          expect(
            await table.locator('tbody tr').count(),
          ).toBeGreaterThanOrEqual(3);
          const scrollRegion = page.getByRole('region', {
            name: contentDocument.frontmatter.title,
            exact: true,
          });
          await expect(scrollRegion).toHaveAttribute('tabindex', '0');
          if (width === 320) {
            await expect(scrollRegion).toHaveAccessibleDescription(/.+/);
            await page
              .locator('article h2')
              .first()
              .getByRole('button')
              .focus();
            await page.keyboard.press('Tab');
            await expect(scrollRegion).toBeFocused();
            await expect(scrollRegion).toHaveCSS('outline-style', 'solid');
            await page.keyboard.press('ArrowRight');
            await expect
              .poll(() =>
                scrollRegion.evaluate((element) => element.scrollLeft),
              )
              .toBeGreaterThan(0);
            await page.keyboard.press('ArrowLeft');
            await expect
              .poll(() =>
                scrollRegion.evaluate((element) => element.scrollLeft),
              )
              .toBe(0);
            await page.keyboard.press('Tab');
            await expect(scrollRegion).not.toBeFocused();
            await page.setViewportSize({ width: 1440, height: 900 });
            await expect(scrollRegion).not.toHaveAttribute('aria-describedby');
            await page.setViewportSize({ width, height: 900 });
            await expect(scrollRegion).toHaveAccessibleDescription(/.+/);
          } else {
            await expect(scrollRegion).not.toHaveAttribute('aria-describedby');
            expect(
              await scrollRegion.evaluate(
                (element) => element.scrollWidth <= element.clientWidth + 1,
              ),
            ).toBe(true);
          }
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

test('a comparison links to its relevant use case', async ({ page }) => {
  await page.goto('/compare/tale-vs-dust');
  const next = page
    .locator('main a[href="/use-cases/marketing-campaigns"]')
    .first();
  await next.click();
  await expect(page).toHaveURL('/use-cases/marketing-campaigns');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
});

for (const locale of ['en', 'de', 'fr'] as const) {
  for (const category of ['compare', 'use-cases']) {
    test(`${locale} unknown ${category} slugs recover without mounting a content page`, async ({
      page,
    }) => {
      const prefix = locale === 'en' ? '' : `/${locale}`;
      await page.goto(`${prefix}/${category}/not-a-published-guide`);
      await expect(page.locator('meta[name=robots]')).toHaveAttribute(
        'content',
        'noindex,nofollow',
      );
      await expect(
        page.locator(`main a[href="${prefix || '/'}"]`).first(),
      ).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    });
  }
}
