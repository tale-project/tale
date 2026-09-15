import { expect, test } from '@playwright/test';
import { createI18n } from '@tale/e2e/i18n';
import { collectConsoleErrors, expectPageRenders } from '@tale/e2e/smoke';

/**
 * Design-system docs smoke. The site speaks two design languages, so the
 * suite crosses the seam: the marketing front page, then the shared docs
 * frame under `/docs` with its rail, its live examples and its search palette.
 *
 * Labels resolve from `messages/en.yml` (en-US pinned by the shared config)
 * over the `@tale/ui` catalog, which owns the docs frame's copy. The search
 * palette's strings are addressed by role instead.
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

const BUTTON_PAGE = '/docs/components/button';
/** Demos the Button page carries today. A floor rather than an exact count:
 *  the point is that the markdown after the FIRST `<Demo/>` still renders, and
 *  the page is free to gain examples. */
const BUTTON_PAGE_DEMOS = 6;

test.describe('front page', () => {
  test('renders the hero and its call to action, with no console errors', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/');
    await expectPageRenders(page);

    await expect(
      page.getByRole('heading', { level: 1, name: t('home.heroTitle') }),
    ).toBeVisible();
    const cta = page.getByRole('link', { name: t('home.heroPrimary') }).first();
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute(
      'href',
      '/docs/getting-started/introduction',
    );

    expect(errors).toEqual([]);
  });
});

test.describe('documentation page', () => {
  test('renders the rail, the title and a live example', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto(BUTTON_PAGE);

    const rail = page.getByRole('navigation', {
      name: t('nav.sidebarAriaLabel'),
    });
    await expect(rail).toBeVisible();
    await expect(rail.locator('[aria-current="page"]')).toHaveAttribute(
      'href',
      BUTTON_PAGE,
    );
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Button');

    // The preview surface renders the real component, not a screenshot.
    const preview = page.getByText(t('demo.preview')).first();
    await expect(preview).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Primary', exact: true }),
    ).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('the header strip sits on the rail logo row line', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BUTTON_PAGE);
    // The strip carries page actions; it must stay the rail's `h-13` bar,
    // border included, so the two bottom borders meet as one line.
    await expect(
      page.getByRole('navigation', { name: t('docs.breadcrumbs') }),
    ).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: t('nav.sidebarAriaLabel') }),
    ).toBeVisible();
    const bars = await page.evaluate(
      ([trailLabel, railLabel]) => {
        const trail = document.querySelector(`nav[aria-label="${trailLabel}"]`);
        const rail = document.querySelector(`nav[aria-label="${railLabel}"]`);
        const strip = trail?.parentElement?.getBoundingClientRect();
        const row = rail?.firstElementChild?.getBoundingClientRect();
        return strip && row
          ? {
              strip: [strip.height, strip.bottom],
              row: [row.height, row.bottom],
            }
          : null;
      },
      [t('docs.breadcrumbs'), t('nav.sidebarAriaLabel')] as const,
    );
    expect(bars).not.toBeNull();
    expect(bars?.strip).toEqual(bars?.row);
  });

  test('the Code toggle reveals the example source', async ({ page }) => {
    await page.goto(BUTTON_PAGE);
    const article = page.locator('article');
    // The page's prose carries fenced blocks of its own, so the demo's source
    // is identified by its content rather than by position.
    const source = article
      .locator('pre')
      .filter({ hasText: 'export default function ButtonVariants' });
    await expect(source).toHaveCount(0);

    const toggle = article
      .getByRole('button', { name: t('demo.showCode'), exact: true })
      .first();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();

    await expect(
      article.getByRole('button', { name: t('demo.hideCode') }).first(),
    ).toHaveAttribute('aria-expanded', 'true');
    // The block is labelled with the demo's own file, so a reader knows what
    // they are looking at and where it lives.
    await expect(article.getByText('button/variants.tsx')).toBeVisible();
    await expect(source).toHaveCount(1);
    await expect(source).toBeVisible();
  });

  test('the body after the first example still renders', async ({ page }) => {
    await page.goto(BUTTON_PAGE);
    const article = page.locator('article');
    // A self-closing `<Demo/>` that the HTML parser reads as an OPEN element
    // swallows every sibling after it — the page would stop at the first demo.
    const toggles = article.getByRole('button', {
      name: t('demo.showCode'),
      exact: true,
    });
    await expect
      .poll(() => toggles.count())
      .toBeGreaterThanOrEqual(BUTTON_PAGE_DEMOS);
    await expect(
      article.getByRole('heading', {
        level: 2,
        name: 'Accessibility and alternatives',
      }),
    ).toBeVisible();
  });

  test('the outline rail appears at desktop width', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(BUTTON_PAGE);
    const outline = page.getByRole('complementary', {
      name: t('docs.onThisPage'),
    });
    await expect(outline).toBeVisible();
    await expect(
      outline.getByRole('link', { name: 'Variants' }),
    ).toHaveAttribute('href', '#variants');
  });

  test('follows the system theme until the reader picks one', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(BUTTON_PAGE);
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

  test('the theme switcher flips the document theme', async ({ page }) => {
    await page.goto(BUTTON_PAGE);
    const isDark = () =>
      page.evaluate(() => document.documentElement.classList.contains('dark'));
    const before = await isDark();

    await page.getByRole('button', { name: 'Switch theme' }).click();
    await page
      .getByRole('menuitemradio', { name: before ? 'Light' : 'Dark' })
      .click();

    await expect.poll(isDark).toBe(!before);
  });
});

test.describe('routing', () => {
  test('/docs redirects to the first page in nav order', async ({ page }) => {
    await page.goto('/docs');
    await expect(page).toHaveURL(/\/docs\/getting-started\/introduction$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Introduction',
    );
  });

  test('an unknown page renders the 404 with a way back', async ({ page }) => {
    await page.goto('/docs/nope');
    await expect(
      page.getByRole('heading', { level: 1, name: t('docs.notFound.title') }),
    ).toBeVisible();
    const back = page.getByRole('link', { name: t('docs.notFound.backHome') });
    await expect(back).toHaveAttribute(
      'href',
      '/docs/getting-started/introduction',
    );
    await back.click();
    await expect(page).toHaveURL(/\/docs\/getting-started\/introduction$/);
  });
});

test.describe('search', () => {
  test('⌘K opens the palette and finds a component page', async ({ page }) => {
    await page.goto(BUTTON_PAGE);

    // The palette itself opens without the index, but a query cannot answer
    // without it — skip rather than fail when the artifact was never built.
    const index = await page.request.get('/search-index.json');
    test.skip(
      !index.ok() || !(index.headers()['content-type'] ?? '').includes('json'),
      'search index not served — run `bun run --filter @tale/ui-docs build:content`',
    );

    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog');
    await expect(palette).toBeVisible();
    const input = palette.getByRole('combobox');
    await expect(input).toBeFocused();

    await input.fill('button');
    await expect(
      palette.getByRole('option', { name: /Button/ }).first(),
    ).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
  });
});
