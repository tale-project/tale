import { ImageZoom } from '@tale/ui/markdown/components/image-zoom';
import type { ComponentPropsWithoutRef } from 'react';

import { IMAGE_DIMENSIONS } from '@/app/content/image-dimensions';
import { rebaseImageSrc } from '@/lib/content/image-src';
import {
  DOCS_IMAGE_SIZES,
  docsResponsiveImage,
} from '@/lib/content/image-variants';

// Vite injects BASE_URL from the `base` config (always trailing-slashed).
const BASE_URL = import.meta.env.BASE_URL ?? '/';

/**
 * Markdown `img` override for docs pages: the default `ImageZoom` mapping,
 * with root-absolute content srcs (`/images/…`) rebased onto the deploy
 * mount point so screenshots resolve when the app is served under a
 * sub-path (e.g. tale.dev/docs). A screenshot with generated variants
 * (`scripts/optimize-images.ts`) is served at the width its slot needs, with
 * its intrinsic size reserved; the lightbox opens the original.
 */
export function DocsImage({ src, alt }: ComponentPropsWithoutRef<'img'>) {
  const file = src?.startsWith('/images/') ? src.slice(1) : undefined;
  const size = file ? IMAGE_DIMENSIONS[file] : undefined;
  return (
    <ImageZoom
      src={rebaseImageSrc(BASE_URL, src)}
      alt={alt}
      image={
        file && size ? docsResponsiveImage(BASE_URL, file, ...size) : undefined
      }
      sizes={DOCS_IMAGE_SIZES}
    />
  );
}
