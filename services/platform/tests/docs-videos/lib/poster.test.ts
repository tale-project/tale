import {
  FIXED_IMAGE_WIDTHS,
  IMAGE_MAX_BYTES,
  IMAGE_QUALITY,
} from '@tale/ui/images/responsive';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { encodePoster } from './poster';

async function frame(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: '#f4f5f7' },
  })
    .png()
    .toBuffer();
}

describe('encodePoster', () => {
  it('scales a 1080p frame to the policy poster width as a WebP within budget', async () => {
    const poster = await encodePoster(await frame(1920, 1080), 'ep1 poster');
    expect(poster).toMatchObject({
      width: FIXED_IMAGE_WIDTHS.videoPoster,
      height: 900,
      quality: IMAGE_QUALITY.screen.webp,
    });
    expect(await sharp(poster.bytes).metadata()).toMatchObject({
      format: 'webp',
      width: FIXED_IMAGE_WIDTHS.videoPoster,
      height: 900,
    });
    expect(poster.bytes.byteLength).toBeLessThanOrEqual(IMAGE_MAX_BYTES);
  });

  it('never upscales a frame narrower than the poster width', async () => {
    const poster = await encodePoster(await frame(1280, 720), 'small poster');
    expect(poster).toMatchObject({ width: 1280, height: 720 });
  });
});
