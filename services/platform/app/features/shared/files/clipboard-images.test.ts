// The one clipboard-image extraction both paste surfaces (chat composer,
// task modal) attach with: image items become File objects named
// `pasted-image-N.<ext>` off the caller's counter; everything else in the
// clipboard is ignored so a text-only paste stays a native paste.

import { describe, expect, it } from 'vitest';

import { extractPastedImageFiles } from './clipboard-images';

function transferWith(
  items: Array<{ type: string; file: File | null }>,
): DataTransfer {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal DataTransfer stand-in for the fields the extractor reads
  return {
    items: items.map((item) => ({
      type: item.type,
      getAsFile: () => item.file,
    })),
  } as unknown as DataTransfer;
}

describe('extractPastedImageFiles', () => {
  it('names image items off the caller counter, keeping their type', () => {
    let counter = 3;
    const files = extractPastedImageFiles(
      transferWith([
        {
          type: 'image/png',
          file: new File(['a'], 'x', { type: 'image/png' }),
        },
        {
          type: 'image/jpeg',
          file: new File(['b'], 'y', { type: 'image/jpeg' }),
        },
      ]),
      () => counter++,
    );
    expect(files.map((file) => file.name)).toEqual([
      'pasted-image-3.png',
      'pasted-image-4.jpeg',
    ]);
    expect(files.map((file) => file.type)).toEqual(['image/png', 'image/jpeg']);
  });

  it('ignores non-image items and null files — a text paste extracts nothing', () => {
    let counter = 1;
    const files = extractPastedImageFiles(
      transferWith([
        { type: 'text/plain', file: null },
        { type: 'text/html', file: null },
        { type: 'image/png', file: null },
      ]),
      () => counter++,
    );
    expect(files).toEqual([]);
    expect(counter).toBe(1); // the counter never burns on a miss
  });
});
