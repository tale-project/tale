import { expect, test } from '@playwright/test';
import { createI18n } from '@tale/e2e/i18n';

const { t } = createI18n(new URL('../../../messages/en.yml', import.meta.url));

test.describe('changelog timeline', () => {
  test('sticky nav scrolls so late versions stay clickable', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/changelog');

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

  test('clicking a mid timeline link updates aria-current', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/changelog');

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

    await page.goto('/changelog');

    await expect(page.locator('article#v9\\.9\\.9')).toBeVisible();
    await expect(
      page.getByText('Runtime feed reached the page.'),
    ).toBeVisible();
  });

  test('falls back to the snapshot when the feed fails', async ({ page }) => {
    await page.route('**/api/releases', (route) =>
      route.fulfill({ status: 503, json: { error: 'upstream' } }),
    );

    await page.goto('/changelog');

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
