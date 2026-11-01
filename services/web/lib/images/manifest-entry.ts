import type { ResponsiveImage } from '@tale/ui/images/responsive';

export interface ImageManifestEntry extends ResponsiveImage {
  id: string;
  blurDataURL: string;
}

/** Generated assets share their directory and naming convention. Keep that
 * repeated text out of the browser bundle while preserving the public shape. */
export function imageEntry<const Id extends string>(
  id: Id,
  width: number,
  height: number,
  blurDataURL: string,
  avifWidths: readonly number[],
  webpWidths: readonly number[],
): ImageManifestEntry & { id: Id } {
  const variants = (format: string, widths: readonly number[]) =>
    Object.fromEntries(
      widths.map((size) => [
        size,
        `/marketing/optimized/${id}-${size}.${format}`,
      ]),
    );
  return {
    id,
    width,
    height,
    blurDataURL,
    variants: {
      avif: variants('avif', avifWidths),
      webp: variants('webp', webpWidths),
    },
  };
}
