import { describe, expect, it } from 'vitest';

import { CHAT_IMAGE_MODEL_MAX_SIZE } from '@/lib/shared/file-types';

import { compressImage } from './compress-image';

// Runs in real Chromium (the `browser` vitest project): the canvas redraw and
// the browser's own PNG and JPEG encoders decide what the composer uploads,
// and jsdom has neither.

/** Encoding a few megapixels takes the browser a second or two. */
const ENCODE_TIMEOUT_MS = 30_000;

/** What the chat composer asks for: the largest image its model is shown. */
const CHAT_LIMIT = { limit: CHAT_IMAGE_MODEL_MAX_SIZE };

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error(`the canvas gave no ${type}`));
    }, type);
  });
}

/**
 * A PNG of random noise with a black box in it, where the text would be:
 * noise is what a scan, a photo or a detailed screenshot does to a PNG, which
 * then hardly shrinks when it is only resized. With `transparentRows`, that
 * many rows at the top are fully transparent.
 */
async function noisyPng(
  width: number,
  height: number,
  transparentRows = 0,
): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  const pixels = ctx.createImageData(width, height);
  let seed = 0x2f6b_4e1d;
  for (let i = 0; i < pixels.data.length; i += 4) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    pixels.data[i] = seed & 0xff;
    pixels.data[i + 1] = (seed >>> 8) & 0xff;
    pixels.data[i + 2] = (seed >>> 16) & 0xff;
    pixels.data[i + 3] = i < transparentRows * width * 4 ? 0 : 255;
  }
  ctx.putImageData(pixels, 0, 0);
  ctx.fillStyle = '#000000';
  ctx.fillRect(width / 4, height / 2, width / 2, height / 8);
  const blob = await toBlob(canvas, 'image/png');
  return new File([blob], 'scan.png', { type: 'image/png' });
}

/** The colour and opacity of one pixel of `file`, decoded by the browser,
 * at a place given as fractions of its width and height. */
async function pixelAt(
  file: File,
  fx: number,
  fy: number,
): Promise<{
  width: number;
  height: number;
  rgba: [number, number, number, number];
}> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(bitmap, 0, 0);
  const x = Math.floor(bitmap.width * fx);
  const y = Math.floor(bitmap.height * fy);
  const [r = 0, g = 0, b = 0, a = 0] = ctx.getImageData(x, y, 1, 1).data;
  return { width: bitmap.width, height: bitmap.height, rgba: [r, g, b, a] };
}

describe('compressImage (real browser)', () => {
  it(
    'brings a noisy PNG under the limit a model is shown, as a JPEG',
    async () => {
      const file = await noisyPng(2400, 1600);
      // The case the composer used to upload unchanged in size: a PNG
      // redrawn at 2048 px is still several MB.
      expect(file.size).toBeGreaterThan(3 * CHAT_IMAGE_MODEL_MAX_SIZE);

      const result = await compressImage(file, CHAT_LIMIT);

      expect(result.wasCompressed).toBe(true);
      expect(result.finalSize).toBeLessThanOrEqual(CHAT_IMAGE_MODEL_MAX_SIZE);
      expect(result.file.type).toBe('image/jpeg');
      expect(result.file.name).toBe('scan.jpg');
      // The middle of the black box, whatever size the image was fitted at.
      const { width, height, rgba } = await pixelAt(result.file, 0.5, 0.5625);
      expect(Math.max(width, height)).toBeLessThanOrEqual(2048);
      expect(width / height).toBeCloseTo(2400 / 1600, 1);
      // Inside the black box: the text stays dark.
      expect(Math.max(...rgba.slice(0, 3))).toBeLessThan(64);
    },
    ENCODE_TIMEOUT_MS,
  );

  it(
    'keeps a transparent area transparent, or white when it has to become a JPEG',
    async () => {
      const file = await noisyPng(3000, 3000, 300);
      expect(file.size).toBeGreaterThan(CHAT_IMAGE_MODEL_MAX_SIZE);

      const result = await compressImage(file, CHAT_LIMIT);

      expect(result.finalSize).toBeLessThanOrEqual(CHAT_IMAGE_MODEL_MAX_SIZE);
      const { rgba } = await pixelAt(result.file, 0.5, 0.01);
      if (result.file.type === 'image/png') {
        expect(rgba[3]).toBe(0);
      } else {
        expect(result.file.type).toBe('image/jpeg');
        // Drawn on white: a transparent pixel never turns black.
        expect(Math.min(...rgba.slice(0, 3))).toBeGreaterThan(240);
      }
    },
    ENCODE_TIMEOUT_MS,
  );

  it(
    'leaves a PNG that is already small enough as it is',
    async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 2400;
      canvas.height = 1600;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.fillStyle = '#d0d0d0';
      ctx.fillRect(0, 0, 2400, 1600);
      const blob = await toBlob(canvas, 'image/png');
      const file = new File([blob], 'plain.png', { type: 'image/png' });

      const result = await compressImage(file, CHAT_LIMIT);

      expect(result.wasCompressed).toBe(false);
      expect(result.file).toBe(file);
    },
    ENCODE_TIMEOUT_MS,
  );

  it(
    'only redraws without a limit, as for a task’s files',
    async () => {
      const file = await noisyPng(2400, 1600);

      const result = await compressImage(file);

      // Redrawn at 2048 px and kept a PNG, however large: an agent reads
      // a task's file as a file, not through a model's request.
      expect(result.file.type).toBe('image/png');
      expect(result.finalSize).toBeGreaterThan(CHAT_IMAGE_MODEL_MAX_SIZE);
      const { width } = await pixelAt(result.file, 0.5, 0.5);
      expect(width).toBe(2048);
    },
    ENCODE_TIMEOUT_MS,
  );
});
