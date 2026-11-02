/**
 * A docs video's poster. `<video poster>` takes one URL with no `srcset`, so
 * every reader loads the same still: it is the one width the shared image
 * policy names for it (`FIXED_IMAGE_WIDTHS.videoPoster`), at the policy's
 * screen quality, through the shared encoder and its byte budget
 * (`@tale/ui/images/responsive`, `@tale/ui/images/encode`).
 * `services/docs/tests/videos.test.ts` holds the committed posters to the same
 * width and budget.
 */

import { encodeImage } from '@tale/ui/images/encode';
import { FIXED_IMAGE_WIDTHS, IMAGE_QUALITY } from '@tale/ui/images/responsive';
import sharp from 'sharp';

export interface EncodedPoster {
  bytes: Buffer;
  width: number;
  height: number;
  /** The quality the encoder settled on to fit the byte budget. */
  quality: number;
}

/** Scale a video frame down to the poster width and encode it as WebP. */
export async function encodePoster(
  frame: Buffer,
  label: string,
): Promise<EncodedPoster> {
  const { bytes, quality } = await encodeImage(
    sharp(frame).resize({
      width: FIXED_IMAGE_WIDTHS.videoPoster,
      withoutEnlargement: true,
    }),
    { format: 'webp', quality: IMAGE_QUALITY.screen.webp, label },
  );
  const { width, height } = await sharp(bytes).metadata();
  return { bytes, width, height, quality };
}
