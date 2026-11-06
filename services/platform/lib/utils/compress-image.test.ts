import { describe, expect, it } from 'vitest';

import {
  fitImage,
  type DecodedImage,
  type EncodeRequest,
} from './compress-image';

const MB = 1024 * 1024;
const LIMIT = 2 * MB;

/**
 * A decoded image whose encodings weigh what `weigh` says, recording every
 * encoding asked for. Sizes stand in for what a browser's encoders make of a
 * detailed picture: a PNG barely shrinks with its area, a JPEG shrinks with
 * its area and its quality.
 */
function decoded(
  width: number,
  height: number,
  options: {
    transparent?: boolean;
    weigh: (request: EncodeRequest) => number;
  },
): DecodedImage & { readonly asked: EncodeRequest[] } {
  const asked: EncodeRequest[] = [];
  return {
    width,
    height,
    asked,
    hasTransparency: () => options.transparent === true,
    encode: (request) => {
      asked.push(request);
      return Promise.resolve(
        new Blob([new Uint8Array(Math.round(options.weigh(request)))]),
      );
    },
  };
}

/** Bytes per pixel of a noisy picture: a PNG keeps nearly all of them, a
 * JPEG drops more the lower its quality. */
function noisy(request: EncodeRequest): number {
  const pixels = request.width * request.height;
  return request.type === 'image/png'
    ? Math.round(pixels * 3)
    : Math.round(pixels * (request.quality ?? 1) * 1.2);
}

/** A picked file larger than the limit: the case that is stepped down. */
const fit = (image: DecodedImage, sourceType: string, originalSize = 9 * MB) =>
  fitImage(image, {
    sourceType,
    originalSize,
    maxDimension: 2048,
    quality: 0.85,
    limit: LIMIT,
  });

describe('fitImage', () => {
  it('keeps the first redraw when it fits, a PNG as a PNG', async () => {
    const image = decoded(2400, 1600, { weigh: () => 900_000 });
    const fitted = await fit(image, 'image/png');
    expect(fitted?.type).toBe('image/png');
    expect(fitted?.blob.size).toBe(900_000);
    // The longer side is capped at 2048 px, the aspect ratio kept.
    expect(image.asked).toEqual([
      { width: 2048, height: 1365, type: 'image/png' },
    ]);
  });

  it('draws any other picture on white as a JPEG in its first redraw', async () => {
    const image = decoded(1200, 900, { weigh: () => 500_000 });
    const fitted = await fit(image, 'image/webp');
    expect(fitted?.type).toBe('image/jpeg');
    expect(image.asked).toEqual([
      {
        width: 1200,
        height: 900,
        type: 'image/jpeg',
        quality: 0.85,
        background: '#ffffff',
      },
    ]);
  });

  it('turns a PNG with no transparency that is still too large into a JPEG that fits', async () => {
    // 2048×1365 noise: about 8.4 MB as a PNG, 2.4 MB as a JPEG at 0.7,
    // 1.7 MB at 1600 px.
    const image = decoded(2400, 1600, { weigh: noisy });
    const fitted = await fit(image, 'image/png');
    expect(fitted?.type).toBe('image/jpeg');
    expect(fitted?.blob.size).toBeLessThanOrEqual(LIMIT);
    expect(image.asked.map((r) => [r.type, r.width, r.quality])).toEqual([
      ['image/png', 2048, undefined],
      ['image/jpeg', 2048, 0.7],
      ['image/jpeg', 1600, 0.7],
    ]);
    // A JPEG is drawn on white, so no transparent pixel turns black.
    expect(image.asked.at(-1)?.background).toBe('#ffffff');
  });

  it('keeps transparency while a smaller PNG fits', async () => {
    const image = decoded(3000, 3000, {
      transparent: true,
      weigh: (request) =>
        request.type === 'image/png' ? request.width * request.height * 0.9 : 1,
    });
    const fitted = await fit(image, 'image/png');
    // 2048² × 0.9 is 3.8 MB, 1600² × 0.9 is 2.3 MB, 1280² × 0.9 fits.
    expect(fitted?.type).toBe('image/png');
    expect(fitted?.blob.size).toBeLessThanOrEqual(LIMIT);
    expect(image.asked.map((r) => [r.type, r.width])).toEqual([
      ['image/png', 2048],
      ['image/png', 1600],
      ['image/png', 1280],
    ]);
  });

  it('draws a picture with transparency on white as a JPEG when no PNG size fits', async () => {
    const image = decoded(3000, 3000, { transparent: true, weigh: noisy });
    const fitted = await fit(image, 'image/png');
    expect(fitted?.type).toBe('image/jpeg');
    expect(fitted?.blob.size).toBeLessThanOrEqual(LIMIT);
    const pngs = image.asked.filter((r) => r.type === 'image/png');
    expect(pngs.map((r) => r.width)).toEqual([2048, 1600, 1280, 1024]);
    expect(
      image.asked
        .filter((r) => r.type === 'image/jpeg')
        .every((r) => r.background === '#ffffff'),
    ).toBe(true);
  });

  it('steps a JPEG down in quality, then in size, until it fits', async () => {
    const image = decoded(4000, 3000, { weigh: noisy });
    const fitted = await fit(image, 'image/jpeg');
    expect(fitted?.blob.size).toBeLessThanOrEqual(LIMIT);
    expect(image.asked.map((r) => [r.width, r.quality])).toEqual([
      [2048, 0.85],
      [2048, 0.7],
      [1600, 0.7],
    ]);
  });

  it('skips the PNG sizes no smaller than the picture itself', async () => {
    const image = decoded(1400, 1000, { transparent: true, weigh: noisy });
    await fit(image, 'image/png');
    const pngs = image.asked.filter((r) => r.type === 'image/png');
    // Its own size first, then only the steps below 1400 px.
    expect(pngs.map((r) => r.width)).toEqual([1400, 1280, 1024]);
  });

  it('answers the smallest encoding when none fits, for the caller to flag', async () => {
    const image = decoded(2400, 1600, {
      weigh: (request) => 3 * MB + request.width,
    });
    const fitted = await fit(image, 'image/png');
    expect(fitted?.blob.size).toBe(3 * MB + 512);
    expect(fitted?.type).toBe('image/jpeg');
  });

  it('keeps an original within the limit when its redraw is no smaller', async () => {
    // A PNG of 1.5 MB the browser re-encodes to 2.5 MB: the original is shown
    // to the model as it is, never stepped down to a lossy JPEG.
    const image = decoded(1800, 1200, { weigh: () => 2.5 * MB });
    expect(await fit(image, 'image/png', 1.5 * MB)).toBeNull();
    expect(image.asked).toHaveLength(1);
  });

  it('takes the redraw of an original within the limit when it is smaller', async () => {
    const image = decoded(4000, 3000, { weigh: () => 0.9 * MB });
    const fitted = await fit(image, 'image/jpeg', 1.5 * MB);
    expect(fitted?.blob.size).toBe(Math.round(0.9 * MB));
    expect(image.asked).toHaveLength(1);
  });

  it('only redraws without a limit, as for a task’s files', async () => {
    const image = decoded(3000, 3000, { weigh: noisy });
    const fitted = await fitImage(image, {
      sourceType: 'image/png',
      originalSize: 30 * MB,
      maxDimension: 2048,
      quality: 0.85,
      limit: Number.POSITIVE_INFINITY,
    });
    // The 2048 px PNG redraw, however large: an agent reads it as a file.
    expect(fitted?.type).toBe('image/png');
    expect(image.asked.map((r) => [r.type, r.width])).toEqual([
      ['image/png', 2048],
    ]);
  });
});
