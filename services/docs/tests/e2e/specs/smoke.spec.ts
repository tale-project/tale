import { expect, test } from '@playwright/test';
import { createI18n } from '@tale/e2e/i18n';
import { collectConsoleErrors, expectPageRenders } from '@tale/e2e/smoke';

/**
 * Docs-site smoke: the app-style chrome renders — the `SubPanel` rail with its
 * search trigger and nav tree, the sticky header row, and the phone drawer.
 * Labels resolve from `messages/en.yml` (en-US pinned) over the `@tale/ui`
 * catalog, which owns the shared docs frame's copy.
 */

const { t } = createI18n(new URL('../../../messages/en.yml', import.meta.url), {
  packages: [
    new URL(
      '../../../../../packages/ui/src/i18n/messages/global.yml',
      import.meta.url,
    ),
    new URL(
      '../../../../../packages/ui/src/i18n/messages/en.yml',
      import.meta.url,
    ),
  ],
});

const PHONE = { width: 393, height: 852 };

test.describe('docs smoke', () => {
  test('landing renders with a search affordance and no console errors', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/');
    await expectPageRenders(page);
    await expect(
      page.getByRole('button', { name: t('docs.openSearch') }).first(),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('the rail is the labelled navigation landmark', async ({ page }) => {
    await page.goto('/');
    const rail = page.getByRole('navigation', {
      name: t('nav.sidebarAriaLabel'),
    });
    await expect(rail).toBeVisible();
    await expect(rail.getByRole('link').first()).toBeVisible();
    // The rail carries the logo home link and the search trigger above the
    // tree, so the whole chrome lives in one column.
    await expect(
      page.getByRole('link', { name: t('nav.homeAriaLabel') }).first(),
    ).toBeVisible();
  });

  test('the active page is marked in the rail', async ({ page }) => {
    await page.goto('/self-hosted/install/quickstart');
    const rail = page.getByRole('navigation', {
      name: t('nav.sidebarAriaLabel'),
    });
    await expect(rail.locator('[aria-current="page"]')).toHaveAttribute(
      'href',
      '/self-hosted/install/quickstart',
    );
  });

  test('only the open row claims the current page under a locale prefix', async ({
    page,
  }) => {
    // `/de` prefixes every German route, and an active router link sets
    // `aria-current="page"` by itself: the logo, the Previous card (whose
    // neighbour is the locale home) and the 404's way back all once claimed
    // to be the page a reader was on.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/de/get-started/quickstart');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const current = page.locator('a[aria-current="page"]');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveAttribute('href', '/de/get-started/quickstart');

    await page.goto('/de/nope-not-a-page');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('a[aria-current="page"]')).toHaveCount(0);
  });

  test('follows the system theme until the reader picks one', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/self-hosted/install/quickstart');
    const html = page.locator('html');
    const switcher = page.getByRole('button', {
      name: t('themeSwitcher.ariaLabel'),
    });
    await expect(switcher).toBeVisible();
    // Nothing stored: the page follows the operating system. Opening the menu
    // proves React has mounted, so the pre-paint script and the provider
    // agree instead of the provider flipping a dark reader back to light.
    await switcher.click();
    await expect(
      page.getByRole('menuitemradio', { name: t('themeSwitcher.system') }),
    ).toHaveAttribute('aria-checked', 'true');
    await expect(html).toHaveClass(/\bdark\b/);

    // An explicit choice wins over the operating system and survives a reload.
    await page
      .getByRole('menuitemradio', { name: t('themeSwitcher.light') })
      .click();
    await expect(html).not.toHaveClass(/\bdark\b/);
    await page.reload();
    await expect(
      page.getByRole('button', { name: t('themeSwitcher.ariaLabel') }),
    ).toBeVisible();
    await expect(html).not.toHaveClass(/\bdark\b/);
  });

  test('the header row stays pinned while the article scrolls', async ({
    page,
  }) => {
    await page.goto('/self-hosted/install/quickstart');
    const trail = page.getByRole('navigation', { name: t('docs.breadcrumbs') });
    const before = (await trail.boundingBox())!;
    await page.mouse.wheel(0, 1200);
    await expect
      .poll(async () => Math.round(await page.evaluate(() => window.scrollY)))
      .toBeGreaterThan(200);
    const after = (await trail.boundingBox())!;
    expect(Math.abs(after.y - before.y)).toBeLessThan(2);
  });

  test('search palette opens', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('button', { name: t('docs.openSearch') })
      .first()
      .click();
    await expect(
      page.getByPlaceholder(t('docs.search.placeholder')),
    ).toBeVisible();
  });

  test('the phone drawer opens, navigates and restores focus', async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/');
    const menu = page.getByRole('button', { name: t('docs.openMenu') });
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await menu.click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await expect(
      drawer.getByRole('button', { name: t('docs.closeMenu') }),
    ).toBeVisible();
    await expect(
      drawer.getByRole('button', { name: t('docs.openSearch') }),
    ).toBeVisible();
    // One Escape dismisses it — no tooltip layer in the way — and focus lands
    // back on the control that opened it.
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(menu).toBeFocused();

    await menu.click();
    await page
      .getByRole('dialog')
      .locator('a[href="/get-started/quickstart"]')
      .click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page).toHaveURL(/\/get-started\/quickstart$/);
  });

  test('the drawer lets go when the viewport grows past the rail breakpoint', async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/');
    await page.getByRole('button', { name: t('docs.openMenu') }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    // The panel is `md:hidden`, but the overlay Radix portals is not: left
    // open, it would dim the desktop page and swallow every click.
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(
      page.getByRole('navigation', { name: t('nav.sidebarAriaLabel') }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.body.style.pointerEvents),
    ).not.toBe('none');
  });

  test('the outline is a rail at xl and a disclosure below it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/self-hosted/install/quickstart');
    // Both copies ship in the HTML; the one the stylesheet hides is also
    // `aria-hidden`, so exactly one is addressable by role at any width.
    await expect(
      page.getByRole('complementary', { name: t('docs.onThisPage') }),
    ).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: t('docs.onThisPage') }),
    ).toHaveCount(0);

    await page.setViewportSize(PHONE);
    const disclosure = page.getByRole('navigation', {
      name: t('docs.onThisPage'),
    });
    await expect(disclosure).toBeVisible();
    await expect(disclosure.getByRole('link').first()).toBeHidden();
    await disclosure.getByText(t('docs.onThisPage')).click();
    await expect(disclosure.getByRole('link').first()).toBeVisible();
  });
});
