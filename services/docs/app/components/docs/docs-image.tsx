import { ImageZoom } from '@tale/ui/markdown/components/image-zoom';
import { MOBILE_QUERY } from '@tale/ui/use-is-mobile';
import type { ComponentPropsWithoutRef } from 'react';

import { IMAGE_DIMENSIONS } from '@/app/content/image-dimensions';
import { rebaseImageSrc } from '@/lib/content/image-src';
import {
  DOCS_IMAGE_SIZES,
  docsResponsiveImage,
  phoneCaptureFile,
} from '@/lib/content/image-variants';

// Vite injects BASE_URL from the `base` config (always trailing-slashed).
const BASE_URL = import.meta.env.BASE_URL ?? '/';

/**
 * Markdown `img` override for docs pages: the default `ImageZoom` mapping,
 * with root-absolute content srcs (`/images/…`) rebased onto the deploy
 * mount point so screenshots resolve when the app is served under a
 * sub-path (e.g. tale.dev/docs). A screenshot with generated variants
 * (`scripts/optimize-images.ts`) is served at the width its slot needs, with
 * its intrinsic size reserved; the lightbox opens the original. Below Tale's
 * `md` breakpoint, where Tale lays its pages out for a phone, a screenshot
 * with a phone capture serves that capture instead, in the page and in the
 * lightbox.
 */
export function DocsImage({ src, alt }: ComponentPropsWithoutRef<'img'>) {
  const file = src?.startsWith('/images/') ? src.slice(1) : undefined;
  const size = file ? IMAGE_DIMENSIONS[file] : undefined;
  const phoneFile = file ? phoneCaptureFile(file) : undefined;
  const phoneSize = phoneFile ? IMAGE_DIMENSIONS[phoneFile] : undefined;
  return (
    <ImageZoom
      src={rebaseImageSrc(BASE_URL, src)}
      alt={alt}
      image={
        file && size ? docsResponsiveImage(BASE_URL, file, ...size) : undefined
      }
      sizes={DOCS_IMAGE_SIZES}
      sources={
        phoneFile && phoneSize
          ? [
              {
                media: MOBILE_QUERY,
                image: docsResponsiveImage(BASE_URL, phoneFile, ...phoneSize),
                src: rebaseImageSrc(BASE_URL, `/${phoneFile}`),
              },
            ]
          : undefined
      }
    />
  );
}
