import { expect, test, type Page } from '@playwright/test';
import { CLIENT_PAGE_SNAPSHOT, gotoClientPage } from '@tale/e2e/client-page';
import { createI18n } from '@tale/e2e/i18n';

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
      await page.addInitScript(() => {
        const gate = new Promise<void>((resolve) => {
          window.addEventListener('release-page-body', () => resolve(), {
            once: true,
          });
        });
        Object.assign(window, { testPageBodyGate: gate });
      });
      const requested = Promise.withResolvers<void>();
      // main.tsx renders only after the `$.tsx` loader has imported this
      // page's Markdown chunk. Hold the chunk's evaluation, not its fetch, so
      // `load` fires while #root still holds the document's own markup.
      await page.route(
        /\/assets\/documents-[^/]+\.js(?:\?|$)/,
        async (route) => {
          const response = await route.fetch();
          const headers = { ...response.headers() };
          delete headers['content-encoding'];
          delete headers['content-length'];
          await route.fulfill({
            response,
            headers,
            body: `await window.testPageBodyGate;\n${await response.text()}`,
          });
          requested.resolve();
        },
      );

      let committed = false;
      const navigation = gotoClientPage(page, documentsPath).then(() => {
        committed = true;
      });
      try {
        await requested.promise;
        // Negative control: `load` is not the client commit. The complete
        // build CI previews already shows a prerendered figure here (vite
        // preview answers this URL with the root page's prerender), whose
        // image button has no handlers: Enter on it opened nothing (#4536).
        await page.waitForLoadState('load');
        expect(committed).toBe(false);
        await expect(page.locator(CLIENT_PAGE_SNAPSHOT)).toBeAttached();
        const button = page.locator('main figure').first().getByRole('button');
        const prerendered =
          (await button.count()) > 0 ? await button.elementHandle() : null;

        await page.evaluate(() =>
          window.dispatchEvent(new Event('release-page-body')),
        );
        await navigation;
        if (prerendered) {
          // The commit replaced it, with whatever focus it held.
          expect(await prerendered.evaluate((node) => node.isConnected)).toBe(
            false,
          );
        }
        await zoomFirstFigureWithKeyboard(page);
      } finally {
        // A failed step above leaves the gate shut and the navigation open.
        await page
          .evaluate(() => window.dispatchEvent(new Event('release-page-body')))
          .catch((error: unknown) =>
            console.warn('Could not release the held page body', error),
          );
        await navigation.catch((error: unknown) =>
          console.warn('The held client navigation failed', error),
        );
      }
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
