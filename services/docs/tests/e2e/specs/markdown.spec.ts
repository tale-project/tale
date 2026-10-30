import { expect, test, type Page } from '@playwright/test';
import { gotoClientPage } from '@tale/e2e/client-page';
import { createI18n } from '@tale/e2e/i18n';

import { gotoClientPageWithLateBody } from '../helpers/late-page-body';

/** Enter on the first framed screenshot opens it full size; Escape closes it
 * and hands focus back to the image. */
async function zoomFirstFigureWithKeyboard(page: Page) {
  const figure = page.locator('main figure').first();
  await expect(figure.locator('figcaption')).toBeVisible();
  await expect(figure.locator('figcaption')).not.toHaveText('');
  const image = figure.getByRole('button');
  await image.focus();
  await page.keyboard.press('Enter');
  const zoom = page.getByRole('dialog');
  await expect(zoom.getByRole('img')).toBeVisible();
  await expect(zoom.getByRole('img')).toHaveJSProperty('naturalWidth', 2880);
  await page.keyboard.press('Escape');
  await expect(zoom).not.toBeVisible();
  await expect(image).toBeFocused();
}

for (const locale of ['en', 'de', 'fr'] as const) {
  const { t } = createI18n(
    new URL(
      `../../../../../packages/ui/src/i18n/messages/${locale}.yml`,
      import.meta.url,
    ),
  );
  const prefix = locale === 'en' ? '' : `/${locale}`;
  const path = `${prefix}/self-hosted/configuration/approvals`;
  const documentsPath = `${prefix}/platform/knowledge/documents`;

  test.describe(`${locale} rendered Markdown`, () => {
    test('shows frame captions and keeps keyboard image zoom usable', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await gotoClientPage(page, documentsPath);
      await zoomFirstFigureWithKeyboard(page);
    });

    test('zooms with the keyboard only once a late page body has committed', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      const prerendered = await gotoClientPageWithLateBody(
        page,
        documentsPath,
        /\/assets\/documents-[^/]+\.js(?:\?|$)/,
        async () => {
          // The complete build CI previews already shows a prerendered figure
          // here (vite preview answers this URL with the root page's
          // prerender), whose image button has no handlers: Enter on it
          // opened nothing (#4536).
          const button = page
            .locator('main figure')
            .first()
            .getByRole('button');
          return (await button.count()) > 0 ? button.elementHandle() : null;
        },
      );
      if (prerendered) {
        // The commit replaced it, with whatever focus it held.
        expect(await prerendered.evaluate((node) => node.isConnected)).toBe(
          false,
        );
      }
      await zoomFirstFigureWithKeyboard(page);
    });

    test('keeps long inline paths inside the phone viewport without changing their text', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await gotoClientPage(page, path);
      const sourcePath =
        'TALE_CONFIG_DIR/<orgSlug>/governance/approval-policy.yml';
      const inlineCode = page
        .locator('main p > code')
        .filter({ hasText: sourcePath });
      await expect(inlineCode).toHaveText(sourcePath);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(390);
      const fragments = await inlineCode.evaluate((node) =>
        Array.from(node.getClientRects(), (rect) => ({
          left: rect.left,
          right: rect.right,
        })),
      );
      for (const fragment of fragments) {
        expect(fragment.left).toBeGreaterThanOrEqual(0);
        expect(fragment.right).toBeLessThanOrEqual(390);
      }
    });

    test('copies heading links and code with translated labels using the keyboard', async ({
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await gotoClientPage(page, path);
      const heading = page.locator('main h2').first();
      const linkCopy = heading.getByRole('button', {
        name: t('markdownCopy.copyLink'),
        exact: true,
      });
      await linkCopy.focus();
      await page.keyboard.press('Enter');
      await expect(
        heading.getByRole('button', {
          name: t('markdownCopy.linkCopied'),
          exact: true,
        }),
      ).toBeFocused();
      const id = await heading.getAttribute('id');
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
        `${page.url()}#${id}`,
      );
      const codeCopy = page
        .getByRole('button', { name: t('markdownCopy.copyCode'), exact: true })
        .first();
      await codeCopy.focus();
      await page.keyboard.press('Enter');
      await expect(
        page
          .getByRole('button', {
            name: t('markdownCopy.codeCopied'),
            exact: true,
          })
          .first(),
      ).toBeVisible();
      expect(
        await page.evaluate(() => navigator.clipboard.readText()),
      ).toContain('decision: require_approval');
    });
  });
}
