import type { ComponentPropsWithoutRef } from 'react';

import {
  IMAGE_FORMATS,
  type ResponsiveImage,
  sourceSet,
  widestVariant,
} from '../../images/responsive';

interface PictureSource {
  /** Media condition under which this image replaces the default one,
   * e.g. `(max-width: 639px)` for a phone crop. */
  media: string;
  image: ResponsiveImage;
}

interface PictureProps extends Omit<
  ComponentPropsWithoutRef<'img'>,
  'srcSet' | 'sizes' | 'width' | 'height'
> {
  /** The default image: its WebP variants feed the `<img>`, its AVIF
   * variants the source the browser prefers when it decodes AVIF. */
  image: ResponsiveImage;
  /** The rendered slot width, as in `<img sizes>`; the browser picks the
   * smallest variant that covers it at the device pixel ratio. */
  sizes: string;
  /** Art-directed images, first match wins. Each carries its own intrinsic
   * size, so the box is reserved for whichever one the browser picks. */
  sources?: readonly PictureSource[];
}

/**
 * `<picture>` for a raster encoded along the shared ladder
 * (`@tale/ui/images/responsive`): an AVIF and a WebP candidate set per
 * image, and the intrinsic `width`/`height` on every choice so the layout is
 * reserved before a byte arrives. `src` defaults to the widest WebP variant,
 * which only a browser without `srcset` support loads. The remaining props
 * go to the `<img>`.
 */
export function Picture({
  image,
  sizes,
  sources = [],
  src,
  alt,
  ...props
}: PictureProps) {
  return (
    <picture>
      {sources.flatMap(({ media, image: art }) =>
        IMAGE_FORMATS.map((format) => (
          <source
            key={`${media} ${format}`}
            media={media}
            type={`image/${format}`}
            srcSet={sourceSet(art.variants[format])}
            sizes={sizes}
            width={art.width}
            height={art.height}
          />
        )),
      )}
      <source
        type="image/avif"
        srcSet={sourceSet(image.variants.avif)}
        sizes={sizes}
      />
      <img
        src={src ?? widestVariant(image.variants.webp)}
        srcSet={sourceSet(image.variants.webp)}
        sizes={sizes}
        width={image.width}
        height={image.height}
        alt={alt}
        {...props}
      />
    </picture>
  );
}
