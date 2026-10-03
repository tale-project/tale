import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { readMarketingContent } from '../../../lib/content/server';

const articles = readMarketingContent().filter(
  (page) => page.category === 'blog' && page.slug !== 'index',
);
test.use({ contextOptions: { reducedMotion: 'reduce' } });

for (const locale of ['en', 'de', 'fr'] as const) {
  const prefix = locale === 'en' ? '' : `/${locale}`;
  for (const colorScheme of ['light', 'dark'] as const) {
    for (const width of [320, 390, 768, 1024, 1440]) {
      test(`${locale} blog reads at ${width}px in ${colorScheme}`, async ({
        page,
      }) => {
        await page.emulateMedia({ colorScheme });
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${prefix}/blog`);
        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
        const cards = page
          .locator('main a')
          .filter({ has: page.locator('picture') });
        await expect(cards).toHaveCount(10);
        await cards.locator('h3').first().scrollIntoViewIfNeeded();
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width);
        const article = articles.find(
          (entry) =>
            entry.locale === locale && entry.frontmatter.topicId === 'T03',
        );
        expect(article).toBeDefined();
        await page
          .locator(`main a[href="${article?.url}"]`)
          .filter({ has: page.locator('picture') })
          .click();
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(
          article!.frontmatter.title,
        );
        await expect(page.locator('main figure picture img')).toHaveAttribute(
          'alt',
          article!.frontmatter.coverAlt!,
        );
        await expect(page.locator('main figure picture img')).toHaveAttribute(
          'width',
          /\d+/,
        );
        await expect(
          page.locator('main figure picture source'),
        ).toHaveAttribute('srcset', /480w.*828w.*1200w.*1600w/);
        const table = page.locator('article [role="region"]').first();
        await table.scrollIntoViewIfNeeded();
        await expect(table).toHaveAttribute('tabindex', '0');
        await table.focus();
        await page.keyboard.press('Tab');
        await page.keyboard.press('Shift+Tab');
        await expect(table).toBeFocused();
        await expect(table).toHaveCSS('outline-style', 'solid');
        if (width < 640) {
          await page.keyboard.press('ArrowRight');
          await expect
            .poll(() => table.evaluate((element) => element.scrollLeft))
            .toBeGreaterThan(0);
        }
        const diagram = page.locator('article img');
        await diagram.scrollIntoViewIfNeeded();
        await expect
          .poll(() =>
            diagram.evaluate(
              (element: HTMLImageElement) =>
                element.complete && element.naturalWidth > 0,
            ),
          )
          .toBe(true);
        await expect(diagram).toHaveAttribute(
          'src',
          `/blog/diagrams/${locale}/T03-diagram.svg`,
        );
        const download = page
          .locator(`article a[href^="/blog/worksheets/${locale}/"]`)
          .first();
        await expect(download).toHaveCount(1);
        const worksheetPath = (await download.getAttribute('href'))!;
        const response = await page.request.get(worksheetPath);
        expect(response.ok()).toBe(true);
        expect(await response.text()).toBe(
          readFileSync(
            new URL(`../../../public${worksheetPath}`, import.meta.url),
            'utf8',
          ),
        );
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width);
        await expect(
          page.locator(`main a[href="${prefix}/blog"]`).first(),
        ).toBeVisible();
      });
    }
  }

  test(`${locale} blog metadata and language links preserve the article`, async ({
    page,
  }) => {
    const article = articles.find(
      (entry) => entry.locale === locale && entry.frontmatter.topicId === 'T06',
    )!;
    await page.goto(article.url);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      `https://tale.dev${article.url}`,
    );
    await expect(page.locator('link[hreflang="fr"]')).toHaveAttribute(
      'href',
      `https://tale.dev/fr${article.path}`,
    );
    const jsonLd = await page
      .locator('script[type="application/ld+json"]')
      .allTextContents();
    const posting = jsonLd
      .map((text) => JSON.parse(text))
      .find((value) => value['@type'] === 'BlogPosting');
    expect(posting?.headline).toBe(article.frontmatter.title);
    expect(posting?.datePublished).toBeUndefined();
    expect(posting?.image).toContain('/blog/covers/T06-1200.webp');
    await page.goto(`${prefix}/blog/not-a-published-article`);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex,nofollow',
    );
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  });
}
