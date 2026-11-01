/**
 * The responsive-image policy every Tale site shares: one width ladder, the
 * formats each width is encoded in, their starting qualities and the byte
 * budget one variant must fit. The marketing site (`services/web`) and the
 * docs (`services/docs`) generate their committed variants from it with
 * `encodeImage` (`@tale/ui/images/encode`) and render them with `<Picture>`
 * (`@tale/ui/picture`).
 */

/** Widths, in image pixels, that a raster is encoded at. */
export const IMAGE_WIDTHS = [480, 828, 1200, 1600, 2400, 2880] as const;

/** Every width is encoded in each format; the order is the `<source>` order. */
export const IMAGE_FORMATS = ['avif', 'webp'] as const;

export type ImageFormat = (typeof IMAGE_FORMATS)[number];

/** Starting quality per format. A product capture (`screen`) keeps its UI
 * text crisp; marketing artwork (`photo`) tolerates more compression. */
export const IMAGE_QUALITY = {
  screen: { avif: 80, webp: 90 },
  photo: { avif: 64, webp: 78 },
} as const satisfies Record<string, Record<ImageFormat, number>>;

/** Ceiling for one encoded variant. */
export const IMAGE_MAX_BYTES = 200 * 1024;
/** The encoder lowers quality by this step to fit the ceiling… */
export const IMAGE_QUALITY_STEP = 2;
/** …and rejects the image below this floor instead of shipping it muddy. */
export const IMAGE_MIN_QUALITY = 60;

/** A raster encoded along the ladder: its intrinsic size, and the URL of
 * each variant by format and width. */
export interface ResponsiveImage {
  width: number;
  height: number;
  variants: {
    avif: Record<number, string>;
    webp: Record<number, string>;
  };
}

/**
 * The ladder widths an image `width` pixels wide is encoded at: every width
 * up to its own and to `max`, never an upscale. `native` adds the image's own
 * width when it fits under `max`, so the sharpest variant is the image itself
 * rather than the ladder width below it.
 */
export function ladderWidths(
  width: number,
  { max = Infinity, native = false }: { max?: number; native?: boolean } = {},
): number[] {
  const widths: number[] = IMAGE_WIDTHS.filter(
    (size) => size <= Math.min(width, max),
  );
  return native && width <= max ? [...new Set([...widths, width])] : widths;
}

/** A `srcset` value for one format's variants: `url 480w, url 828w, …`. */
export function sourceSet(variants: Readonly<Record<number, string>>): string {
  return Object.entries(variants)
    .map(([width, url]) => `${url} ${width}w`)
    .join(', ');
}

/** The URL of the widest variant, or `undefined` when there is none. */
export function widestVariant(
  variants: Readonly<Record<number, string>>,
): string | undefined {
  // Integer keys enumerate in ascending order.
  return Object.values(variants).at(-1);
}
