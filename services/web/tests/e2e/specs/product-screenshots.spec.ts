import { expect, test } from '@playwright/test';
import { createI18n } from '@tale/e2e/i18n';

import {
  PRODUCT_SCREENSHOTS,
  productScreenshotId,
} from '../../../app/content/product-screenshots';
import { IMAGE_MANIFEST } from '../../../app/generated/image-manifest';
import { gotoClientPage } from '../helpers/client-page';

const catalogs = {
  en: createI18n(new URL('../../../messages/en.yml', import.meta.url)),
  de: createI18n(new URL('../../../messages/de.yml', import.meta.url)),
  fr: createI18n(new URL('../../../messages/fr.yml', import.meta.url)),
};

test.use({ contextOptions: { reducedMotion: 'reduce' } });

for (const locale of ['en', 'de', 'fr'] as const) {
  for (const width of [320, 1440] as const) {
    test(`${locale} product screenshots load the correct sources at ${width}px`, async ({
      page,
    }) => {
      const { t } = catalogs[locale];
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({
        colorScheme: width === 320 ? 'light' : 'dark',
      });
      for (const [id, screenshot] of Object.entries(PRODUCT_SCREENSHOTS)) {
        const path =
          id === 'home' ? '/' : id === 'hub' ? '/platform' : `/platform/${id}`;
        await gotoClientPage(
          page,
          locale === 'en' ? path : `/${locale}${path === '/' ? '' : path}`,
        );
        const figure = page.locator(`[data-product-screenshot="${id}"]`);
        const picture = figure.getByRole('img', {
          name: t(`demo.pages.${id}.label`),
          exact: true,
        });
        await expect(picture).toBeVisible();
        await expect
          .poll(() =>
            picture.evaluate(
              (element: HTMLImageElement) =>
                element.complete && element.naturalWidth > 0,
            ),
          )
          .toBe(true);
        const selectedSource = await picture.evaluate(
          (element: HTMLImageElement) => element.currentSrc,
        );
        const sourceId = productScreenshotId(screenshot.source, locale);
        expect(selectedSource).toContain(sourceId);
        expect(selectedSource.includes('-mobile-')).toBe(width === 320);
        expect(selectedSource.includes('-desktop-')).toBe(
          width === 1440 && 'desktopCrop' in screenshot,
        );
        await expect(figure).toContainText(t(`demo.pages.${id}.caption`));
        await expect(figure).toContainText(t('demo.pages.interfaceLanguage'));
        const original = IMAGE_MANIFEST.find((entry) => entry.id === sourceId);
        expect(original).toBeDefined();
        const fullSource = Object.values(original!.variants.webp).at(-1)!;
        const fullLink = figure.getByRole('link', {
          name: t('demo.pages.viewLabel'),
          exact: true,
        });
        await expect(fullLink).toHaveAttribute('href', fullSource);
        await expect(fullLink).toHaveAttribute('target', '_blank');
        const bounds = await figure.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
      }
    });
  }
}
