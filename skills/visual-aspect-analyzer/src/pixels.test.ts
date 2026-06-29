import { describe, expect, test } from 'bun:test';

import { PNG } from 'pngjs';

import { cropRGBA, type DecodedImage, decodePng, noiseEnergy } from './pixels';

describe('noiseEnergy', () => {
  test('identical buffers score 0', () => {
    const a = new Uint8Array([10, 20, 30, 255]);
    expect(noiseEnergy(a, a)).toBe(0);
  });
  test('maximum difference scores 1', () => {
    const a = new Uint8Array([0, 0, 0, 0]);
    const b = new Uint8Array([255, 255, 255, 255]);
    expect(noiseEnergy(a, b)).toBe(1);
  });
  test('partial difference is in between', () => {
    expect(
      noiseEnergy(new Uint8Array([0, 0]), new Uint8Array([255, 0])),
    ).toBeCloseTo(0.5, 5);
  });
  test('empty buffers score 0', () => {
    expect(noiseEnergy(new Uint8Array(), new Uint8Array())).toBe(0);
  });
  test('compares only the overlap of unequal-length buffers', () => {
    // The trailing third byte of `prev` has no counterpart and is ignored.
    expect(
      noiseEnergy(new Uint8Array([255, 0, 99]), new Uint8Array([0, 0])),
    ).toBeCloseTo(0.5, 5);
  });
});

describe('cropRGBA', () => {
  // A 3x2 image where each pixel's R channel encodes its index (0..5), so a crop
  // is easy to verify by reading back the R bytes.
  const img: DecodedImage = {
    width: 3,
    height: 2,
    data: new Uint8Array([
      0,
      0,
      0,
      255,
      1,
      0,
      0,
      255,
      2,
      0,
      0,
      255, // row 0: px 0,1,2
      3,
      0,
      0,
      255,
      4,
      0,
      0,
      255,
      5,
      0,
      0,
      255, // row 1: px 3,4,5
    ]),
  };
  const reds = (buf: Uint8Array): number[] => {
    const out: number[] = [];
    for (let i = 0; i < buf.length; i += 4) out.push(buf[i] ?? -1);
    return out;
  };

  test('crops an in-bounds sub-region', () => {
    const sub = cropRGBA(img, { x: 1, y: 0, width: 2, height: 2 });
    expect(sub).not.toBeNull();
    expect(reds(sub ?? new Uint8Array())).toEqual([1, 2, 4, 5]);
  });

  test('clamps a clip that overflows the image edge', () => {
    const sub = cropRGBA(img, { x: 2, y: 1, width: 5, height: 5 });
    expect(reds(sub ?? new Uint8Array())).toEqual([5]); // only the last pixel
  });

  test('floors sub-pixel coordinates to the grid', () => {
    const sub = cropRGBA(img, { x: 0.6, y: 0.6, width: 1, height: 1 });
    expect(reds(sub ?? new Uint8Array())).toEqual([0]); // floors to (0,0,1,1)
  });

  test('returns null for an off-image or NaN clip', () => {
    expect(cropRGBA(img, { x: 10, y: 10, width: 4, height: 4 })).toBeNull();
    expect(cropRGBA(img, { x: 0, y: 0, width: 0, height: 4 })).toBeNull();
    expect(cropRGBA(img, { x: NaN, y: 0, width: 2, height: 2 })).toBeNull();
  });
});

describe('decodePng', () => {
  test('round-trips a 1x1 image to RGBA', () => {
    const png = new PNG({ width: 1, height: 1 });
    png.data = Buffer.from([12, 34, 56, 255]);
    const img = decodePng(PNG.sync.write(png));
    expect(img.width).toBe(1);
    expect(Array.from(img.data.slice(0, 4))).toEqual([12, 34, 56, 255]);
  });

  test('wraps a decode failure with context', () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3, 4]))).toThrow(
      /Failed to decode PNG screenshot/,
    );
  });
});
