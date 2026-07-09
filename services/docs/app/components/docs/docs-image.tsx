import { ImageZoom } from '@tale/ui/markdown/components/image-zoom';
import type { ComponentPropsWithoutRef } from 'react';

import { rebaseImageSrc } from '@/lib/content/image-src';

// Vite injects BASE_URL from the `base` config (always trailing-slashed).
const BASE_URL = import.meta.env.BASE_URL ?? '/';

/**
 * Markdown `img` override for docs pages: the default `ImageZoom` mapping,
 * with root-absolute content srcs (`/images/…`) rebased onto the deploy
 * mount point so screenshots resolve when the app is served under a
 * sub-path (e.g. tale.dev/docs).
 */
export function DocsImage({ src, alt }: ComponentPropsWithoutRef<'img'>) {
  return <ImageZoom src={rebaseImageSrc(BASE_URL, src)} alt={alt} />;
}
