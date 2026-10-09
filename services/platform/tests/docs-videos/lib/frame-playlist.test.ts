import { describe, expect, it } from 'vitest';

import { buildConcatList } from './frame-playlist';

describe('native compositor frame playlist', () => {
  it('preserves uneven compositor timing and holds the real final frame through the planned end', () => {
    expect(
      buildConcatList(
        [
          { file: 'f000001.jpg', tMs: 0 },
          { file: 'f000002.jpg', tMs: 125 },
          { file: 'f000003.jpg', tMs: 1850 },
        ],
        8000,
      ),
    ).toBe(
      "ffconcat version 1.0\nfile 'f000001.jpg'\nduration 0.1250\nfile 'f000002.jpg'\nduration 1.7250\nfile 'f000003.jpg'\nduration 6.1500\nfile 'f000003.jpg'\n",
    );
  });

  it('keeps zero-timestamp frames readable and rejects a recording with no pictures', () => {
    expect(
      buildConcatList(
        [
          { file: 'f000001.jpg', tMs: 0 },
          { file: 'f000002.jpg', tMs: 0 },
        ],
        100,
      ),
    ).toContain('duration 0.0010');
    expect(() => buildConcatList([], 8000)).toThrow('No frames were recorded');
  });
});
