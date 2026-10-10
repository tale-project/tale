import type {
  ProductScreenshotLocale,
  ProductScreenshotPage,
} from '../../app/content/product-screenshots';
import { imageEntry, type ImageManifestEntry } from '../images/manifest-entry';

export interface ProductMotionVariant {
  webm: string;
  mp4: string;
  width: number;
  height: number;
  durationMs: number;
  posterId: string;
}

export interface ProductMotionEntry {
  desktop: ProductMotionVariant;
  mobile: ProductMotionVariant;
}

export type ProductMotionRegistry = Partial<
  Record<
    ProductScreenshotPage,
    Partial<Record<ProductScreenshotLocale, ProductMotionEntry>>
  >
>;

/** Keep repeated asset URLs out of the generated browser registry. */
function motionEntry(page: string, locale: string): ProductMotionEntry {
  const variant = (
    name: string,
    width: number,
    height: number,
  ): ProductMotionVariant => {
    const base = `/marketing/product-motion/${locale}/${page}-${name}`;
    return {
      webm: `${base}.webm`,
      mp4: `${base}.mp4`,
      width,
      height,
      durationMs: 8000,
      posterId: `motion-${page}-${locale}-${name}`,
    };
  };
  return {
    desktop: variant('desktop', 1280, 800),
    mobile: variant('mobile', 390, 820),
  };
}

export function motionRegistry(
  locales: Partial<
    Record<ProductScreenshotPage, readonly ProductScreenshotLocale[]>
  >,
): ProductMotionRegistry {
  return Object.fromEntries(
    Object.entries(locales).map(([page, languages]) => [
      page,
      Object.fromEntries(
        languages.map((locale) => [locale, motionEntry(page, locale)]),
      ),
    ]),
  );
}

/** Motion posters share their fixed native geometry and responsive widths.
 * They need no blur preview: the native picture remains visible until decode. */
export function motionPosterEntries(
  registry: ProductMotionRegistry,
): ImageManifestEntry[] {
  return Object.values(registry).flatMap((languages) =>
    Object.values(languages).flatMap((entry) =>
      [entry.desktop, entry.mobile].map((variant) => {
        const widths = variant.width === 1280 ? [480, 828, 1200, 1280] : [390];
        return imageEntry(
          variant.posterId,
          variant.width,
          variant.height,
          '',
          widths,
          widths,
        );
      }),
    ),
  );
}
