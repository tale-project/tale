import { expect, test } from '@playwright/test';
import { createI18n } from '@tale/e2e/i18n';

import {
  RELEASES,
  RELEASES_FETCHED_AT,
} from '../../../app/generated/releases-manifest';
import { gotoClientPage } from '../helpers/client-page';

const { t } = createI18n(new URL('../../../messages/en.yml', import.meta.url));

test.describe('changelog timeline', () => {
  // Once the preview server's first refresh lands, `/api/releases` answers
  // GitHub's live list. The E2E build embeds the committed snapshot, which may
  // share no tag with that list; the page's swap then replaces every nav link
  // while a test still holds one. Answer what a cold server answers, the
  // snapshot the page already renders; the feed itself is tested below.
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/releases', (route) =>
      route.fulfill({
        json: {
          releases: RELEASES,
          fetchedAt: RELEASES_FETCHED_AT,
          source: 'snapshot',
        },
      }),
    );
  });

  test('sticky nav scrolls so late versions stay clickable', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoClientPage(page, '/changelog');

    const nav = page.getByRole('navigation', {
      name: t('changelogPage.allReleases'),
    });
    await expect(nav).toBeVisible();

    const links = nav.getByRole('link');
    const count = await links.count();
    expect(count).toBeGreaterThan(10);

    // Last link was unreachable before the sticky column gained overflow-y.
    const last = links.last();
    const href = await last.getAttribute('href');
    expect(href).toMatch(/^#v/);

    await last.scrollIntoViewIfNeeded();
    await last.click();

    const tag = href?.slice(1) ?? '';
    expect(tag.length).toBeGreaterThan(0);
    await expect(page).toHaveURL(new RegExp(`#${tag.replace(/\./g, '\\.')}$`));
    await expect(last).toHaveAttribute('aria-current', 'true');

    const articleTop = await page.evaluate((id) => {
      const el = document.getElementById(id);
      return el?.getBoundingClientRect().top ?? null;
    }, tag);
    expect(articleTop).not.toBeNull();
    expect(articleTop ?? 999).toBeLessThan(200);
    expect(articleTop ?? -1).toBeGreaterThan(0);
  });

  for (const width of [390, 1440]) {
    test(`timeline updates do not pull the document away from the footer at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await gotoClientPage(page, '/changelog');
      await expect(page.locator('article').last()).toBeAttached();
      await page.evaluate(() => document.fonts.ready);

      // Changing the active release used to scroll every ancestor of its
      // timeline link, pulling the viewport back up by hundreds of pixels.
      const samples = await page.evaluate(async () => {
        document.documentElement.scrollTop =
          document.documentElement.scrollHeight - innerHeight - 100;
        const positions = [scrollY];
        for (let frame = 0; frame < 40; frame += 1) {
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
          positions.push(scrollY);
        }
        return positions;
      });
      expect(Math.max(...samples) - Math.min(...samples)).toBeLessThanOrEqual(
        1,
      );
    });
  }

  test('clicking a mid timeline link updates aria-current', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoClientPage(page, '/changelog');

    const nav = page.getByRole('navigation', {
      name: t('changelogPage.allReleases'),
    });
    const first = nav.getByRole('link').first();
    const mid = nav.getByRole('link').nth(4);

    await expect(first).toHaveAttribute('aria-current', 'true');

    await mid.scrollIntoViewIfNeeded();
    await mid.click();
    await expect(mid).toHaveAttribute('aria-current', 'true');
    await expect(first).not.toHaveAttribute('aria-current', 'true');
  });
});

test.describe('changelog release feed', () => {
  // The build-time snapshot cannot carry the newest release (release images are
  // built before the GitHub release is published), so the page refreshes from
  // `/api/releases` after hydration. Both paths are pinned here.
  const liveRelease = {
    tag: 'v9.9.9',
    version: '9.9.9',
    name: null,
    body: '## Highlights\n\nRuntime feed reached the page.',
    htmlUrl: 'https://github.com/tale-project/tale/releases/tag/v9.9.9',
    publishedAt: '2026-08-20T10:00:00Z',
  };

  for (const locale of ['en', 'de', 'fr']) {
    for (const width of [320, 390]) {
      test(`long release identifiers stay readable in ${locale} at ${width}px`, async ({
        page,
      }) => {
        const metric =
          'tale_backend_automation_trigger_scan_last_success_timestamp_seconds';
        const link = `https://example.com/metrics/${metric}`;
        const command = `curl ${link}`;
        await page.setViewportSize({ width, height: 844 });
        await page.route('**/api/releases', (route) =>
          route.fulfill({
            json: {
              releases: [
                {
                  ...liveRelease,
                  body: `## Metrics\n\n- Inspect \`${metric}\`.\n\n${link}\n\n\`\`\`bash\n${command}\n\`\`\``,
                },
              ],
              fetchedAt: '2026-08-21T10:00:00.000Z',
              source: 'live',
            },
          }),
        );
        await gotoClientPage(
          page,
          locale === 'en' ? '/changelog' : `/${locale}/changelog`,
        );
        const article = page.locator('article#v9\\.9\\.9');
        await expect(article.locator('li code')).toHaveText(metric);
        await page.evaluate(() => document.fonts.ready);

        const prose = await article.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          const textBounds = Array.from(
            element.querySelectorAll('li code, p > a'),
          ).flatMap((node) => {
            const range = document.createRange();
            range.selectNodeContents(node);
            return Array.from(range.getClientRects()).map((rect) => ({
              left: rect.left,
              right: rect.right,
            }));
          });
          return {
            bodyWidth: document.body.scrollWidth,
            left: bounds.left,
            right: bounds.right,
            textBounds,
          };
        });
        expect(prose.bodyWidth).toBeLessThanOrEqual(width);
        expect(prose.textBounds.length).toBeGreaterThan(0);
        for (const rect of prose.textBounds) {
          expect(rect.left).toBeGreaterThanOrEqual(prose.left - 1);
          expect(rect.right).toBeLessThanOrEqual(prose.right + 1);
        }

        const block = article.locator('pre');
        await expect(block).toHaveText(`${command}\n`);
        const scroll = await block.evaluate((element) => {
          const before = element.scrollLeft;
          element.scrollLeft = element.scrollWidth;
          return {
            before,
            after: element.scrollLeft,
            overflow: getComputedStyle(element).overflowX,
            whitespace: getComputedStyle(element).whiteSpace,
            right: element.getBoundingClientRect().right,
          };
        });
        expect(scroll.after).toBeGreaterThan(scroll.before);
        expect(scroll.overflow).toBe('auto');
        expect(scroll.whitespace).toBe('pre');
        expect(scroll.right).toBeLessThanOrEqual(width);
      });
    }
  }

  test('renders releases the build-time snapshot never saw', async ({
    page,
  }) => {
    await page.route('**/api/releases', (route) =>
      route.fulfill({
        json: {
          releases: [liveRelease],
          fetchedAt: '2026-08-21T10:00:00.000Z',
          source: 'live',
        },
      }),
    );

    await gotoClientPage(page, '/changelog');

    await expect(page.locator('article#v9\\.9\\.9')).toBeVisible();
    await expect(
      page.getByText('Runtime feed reached the page.'),
    ).toBeVisible();
  });

  test('falls back to the snapshot when the feed fails', async ({ page }) => {
    await page.route('**/api/releases', (route) =>
      route.fulfill({ status: 503, json: { error: 'upstream' } }),
    );

    await gotoClientPage(page, '/changelog');

    const nav = page.getByRole('navigation', {
      name: t('changelogPage.allReleases'),
    });
    await expect(nav.getByRole('link').first()).toHaveAttribute(
      'href',
      /^#v\d+\.\d+\.\d+$/,
    );
    await expect(page.locator('article').first()).toBeVisible();
  });
});
