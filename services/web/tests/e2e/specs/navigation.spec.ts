import { expect, test } from '@playwright/test';
import { createI18n } from '@tale/e2e/i18n';

import { gotoClientPage } from '../helpers/client-page';

test('sticky navigation stays readable over product screenshots in both themes', async ({
  page,
}) => {
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    for (const width of [320, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await gotoClientPage(page, '/fr/platform/automations');
      const header = page.locator('header');
      const screenshot = page.locator('[data-product-screenshot] img').first();
      await expect(screenshot).toBeVisible();
      await screenshot.evaluate((element) => {
        const top = element.getBoundingClientRect().top + window.scrollY;
        window.scrollTo(0, top - 20);
      });
      await expect
        .poll(() =>
          header.evaluate((element) => {
            const context = document.createElement('canvas').getContext('2d');
            if (!context) throw new Error('Color sampling needs a canvas');
            const sample = (color: string) => {
              context.clearRect(0, 0, 1, 1);
              context.fillStyle = color;
              context.fillRect(0, 0, 1, 1);
              return [...context.getImageData(0, 0, 1, 1).data];
            };
            const background = sample(
              getComputedStyle(element).backgroundColor,
            );
            const foreground = sample(
              getComputedStyle(element.querySelector('a')!).color,
            );
            // Product captures use a light surface. Composite that white
            // backing through the header's actual rendered opacity.
            const alpha = background[3] / 255;
            const luminance = (color: number[]) => {
              const channels = color.slice(0, 3).map((channel) => {
                const value = channel / 255;
                return value <= 0.04045
                  ? value / 12.92
                  : ((value + 0.055) / 1.055) ** 2.4;
              });
              return (
                channels[0] * 0.2126 +
                channels[1] * 0.7152 +
                channels[2] * 0.0722
              );
            };
            const backdrop = background
              .slice(0, 3)
              .map((channel) => channel * alpha + 255 * (1 - alpha));
            const values = [luminance(foreground), luminance(backdrop)].sort(
              (left, right) => left - right,
            );
            return (values[1] + 0.05) / (values[0] + 0.05);
          }),
        )
        .toBeGreaterThanOrEqual(4.5);
      const imageBounds = await screenshot.boundingBox();
      const headerBounds = await header.boundingBox();
      expect(imageBounds!.y).toBeLessThan(headerBounds!.height);
      expect(imageBounds!.y + imageBounds!.height).toBeGreaterThan(
        headerBounds!.height,
      );
    }
  }
});

for (const locale of ['en', 'de', 'fr'] as const) {
  const { t } = createI18n(
    new URL(`../../../messages/${locale}.yml`, import.meta.url),
  );
  const prefix = locale === 'en' ? '' : `/${locale}`;

  test(`${locale} desktop navigation exposes overview and comparisons with bounded disclosures`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const width of [1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await gotoClientPage(page, `${prefix}/platform/projects`);
      const header = page.locator('header');
      await expect(
        page
          .locator('main')
          .getByRole('link', {
            name: t('featureShared.ctaGetStarted'),
            exact: true,
          })
          .first(),
      ).toHaveAttribute(
        'href',
        `https://docs.tale.dev${prefix}/get-started/quickstart`,
      );
      const compare = header.getByRole('link', {
        name: t('nav.resource.compare.label'),
        exact: true,
      });
      await expect(compare).toHaveAttribute('href', `${prefix}/compare`);
      await expect(compare).toBeVisible();
      for (const menuKey of ['platform', 'resources'] as const) {
        const trigger = header.getByRole('button', {
          name: t(`nav.${menuKey}`),
          exact: true,
        });
        await trigger.click();
        const panel = header.getByRole('region', {
          name: t(`nav.${menuKey}`),
          exact: true,
        });
        await expect(panel).toBeVisible();
        const bounds = await panel.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(16);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width - 16);
        const triggerBounds = await trigger.boundingBox();
        expect(triggerBounds!.height).toBeGreaterThanOrEqual(44);
        if (menuKey === 'platform') {
          await expect(panel.getByRole('link')).toHaveCount(7);
          await expect(
            panel.getByRole('link', {
              name: t('nav.product.hub.label'),
              exact: false,
            }),
          ).toHaveAttribute('href', `${prefix}/platform`);
          await expect(panel.locator('a[aria-current="page"]')).toHaveCount(1);
          await expect(panel.locator('a[aria-current="page"]')).toHaveAttribute(
            'href',
            `${prefix}/platform/projects`,
          );
        } else {
          await expect(
            header.getByRole('region', {
              name: t('nav.platform'),
              exact: true,
            }),
          ).toHaveCount(0);
          await expect(
            panel.getByRole('link', {
              name: t('nav.resource.docs.label'),
              exact: false,
            }),
          ).toHaveAttribute('href', `https://docs.tale.dev${prefix || '/'}`);
          await expect(
            panel.getByRole('link', {
              name: t('nav.resource.useCases.label'),
              exact: false,
            }),
          ).toHaveAttribute('href', `${prefix}/use-cases`);
          await expect(
            panel.getByRole('link', {
              name: t('nav.resource.compare.label'),
              exact: false,
            }),
          ).toHaveCount(0);
        }
      }
      await expect(
        header.getByRole('link', { name: t('nav.getStarted'), exact: true }),
      ).toHaveAttribute(
        'href',
        `https://docs.tale.dev${prefix}/get-started/quickstart`,
      );
      await expect(
        page.locator('footer').getByRole('link', {
          name: t('nav.resource.docs.label'),
          exact: true,
        }),
      ).toHaveAttribute('href', `https://docs.tale.dev${prefix || '/'}`);
      await page.keyboard.press('Escape');
    }
  });

  test(`${locale} phone navigation groups destinations and closes after navigating`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await gotoClientPage(page, `${prefix}/platform/projects`);
      const opener = page.getByRole('button', {
        name: t('nav.openMenu'),
        exact: true,
      });
      await opener.click();
      const dialog = page.getByRole('dialog', {
        name: t('nav.openMenu'),
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('a[aria-current="page"]')).toHaveCount(1);
      await expect(
        dialog.getByRole('link', {
          name: t('nav.product.hub.label'),
          exact: true,
        }),
      ).toHaveAttribute('href', `${prefix}/platform`);
      await expect(
        dialog.getByRole('link', {
          name: t('nav.resource.useCases.label'),
          exact: true,
        }),
      ).toHaveAttribute('href', `${prefix}/use-cases`);
      await expect(
        dialog.getByRole('link', {
          name: t('nav.resource.docs.label'),
          exact: true,
        }),
      ).toHaveAttribute('href', `https://docs.tale.dev${prefix || '/'}`);
      await expect(
        dialog.getByRole('link', { name: t('nav.getStarted'), exact: true }),
      ).toHaveAttribute(
        'href',
        `https://docs.tale.dev${prefix}/get-started/quickstart`,
      );
      expect(
        await dialog.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      await dialog
        .getByRole('link', {
          name: t('nav.resource.compare.label'),
          exact: true,
        })
        .click();
      await expect(page).toHaveURL(new RegExp(`${prefix}/compare$`));
      await expect(dialog).toHaveCount(0);
      await opener.click();
      await page.keyboard.press('Escape');
      await expect(opener).toBeFocused();
    }
  });
}
