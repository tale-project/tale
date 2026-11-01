import {
  IMAGE_FORMATS,
  type ImageFormat,
  ladderWidths,
  type ResponsiveImage,
} from '@tale/ui/images/responsive';

import { rebaseImageSrc } from './image-src';

/**
 * Responsive variants of the docs screenshots.
 *
 * `scripts/optimize-images.ts` encodes every `/images/….webp` a page
 * references along the shared ladder (`@tale/ui/images/responsive`) into
 * `public/images/optimized/`, mirroring the original's path, and records its
 * intrinsic size in `app/content/image-dimensions.ts`. `DocsImage` serves the
 * variants through `srcset`; the original stays the full-size file at its
 * published URL, which the lightbox opens.
 */

/** The article column is at most 48rem (768 CSS px) wide: 1600 image pixels
 *  cover it at DPR 2, and a wider variant would never be picked. */
export const DOCS_IMAGE_MAX_WIDTH = 1600;

/** The slot a docs image fills: the article column, which is at most 48rem
 *  wide. No `auto` keyword: the client replaces the prerendered page with a
 *  fresh render (`app/main.tsx`), and with `auto` Chrome fetched a wider
 *  variant for a re-created image on top of the one it showed. */
export const DOCS_IMAGE_SIZES = '(min-width: 48rem) 48rem, 100vw';

/** The widths an image `width` pixels wide is served at: the ladder up to
 *  the column's need, plus its own width when it is narrower than that. */
export function docsImageWidths(width: number): number[] {
  return ladderWidths(width, { max: DOCS_IMAGE_MAX_WIDTH, native: true });
}

/** The `public/`-relative file of one variant of `file` (an
 *  `images/….webp` that is `imageWidth` pixels wide). The WebP at the
 *  image's own width is the original itself. */
export function docsImageVariant(
  file: string,
  imageWidth: number,
  width: number,
  format: ImageFormat,
): string {
  if (format === 'webp' && width === imageWidth) return file;
  return file
    .replace(/^images\//, 'images/optimized/')
    .replace(/\.webp$/, `-${width}.${format}`);
}

/** The variants of `file` as URLs under the deploy `base`. */
export function docsResponsiveImage(
  base: string,
  file: string,
  width: number,
  height: number,
): ResponsiveImage {
  const variants: ResponsiveImage['variants'] = { avif: {}, webp: {} };
  for (const size of docsImageWidths(width)) {
    for (const format of IMAGE_FORMATS) {
      const src = `/${docsImageVariant(file, width, size, format)}`;
      variants[format][size] = rebaseImageSrc(base, src) ?? src;
    }
  }
  return { width, height, variants };
}
