import { expect, test } from '@playwright/test';
import { createI18n } from '@tale/e2e/i18n';

for (const locale of ['en', 'de', 'fr'] as const) {
  const { t } = createI18n(
    new URL(
      `../../../../../packages/ui/src/i18n/messages/${locale}.yml`,
      import.meta.url,
    ),
  );
  const prefix = locale === 'en' ? '' : `/${locale}`;
  const path = `${prefix}/self-hosted/configuration/approvals`;

  test.describe(`${locale} rendered Markdown`, () => {
    test('keeps long inline paths inside the phone viewport without changing their text', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(path);
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
      await page.goto(path);
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
