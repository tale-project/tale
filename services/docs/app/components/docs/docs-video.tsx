import { Video } from '@tale/ui/markdown/components/video';
import type { ComponentProps } from 'react';

import { rebaseImageSrc } from '@/lib/content/image-src';

// Vite injects BASE_URL from the `base` config (always trailing-slashed).
const BASE_URL = import.meta.env.BASE_URL ?? '/';

/**
 * Markdown `video` override for docs pages: the shared `Video` figure with
 * every root-absolute asset (`/videos/…`) rebased onto the deploy mount
 * point — the same treatment DocsImage gives screenshot srcs, extended to
 * the poster and the captions track.
 */
export function DocsVideo(props: ComponentProps<typeof Video>) {
  return (
    <Video
      {...props}
      src={rebaseImageSrc(BASE_URL, props.src)}
      poster={rebaseImageSrc(BASE_URL, props.poster)}
      captions={rebaseImageSrc(BASE_URL, props.captions)}
    />
  );
}
