import { describe, expect, it } from 'vitest';

import { MAX_FILE_URL_IDS } from './file-types';
import { prepareFileUrlIds } from './file-url-batch';

describe('prepareFileUrlIds', () => {
  it('dedupes and keeps more than the old chat-era batch of 10', () => {
    const ids = Array.from({ length: 25 }, (_, i) => `id_${i}`);
    const withDupes = [...ids, 'id_0', 'id_1'];
    expect(prepareFileUrlIds(withDupes)).toEqual(ids);
    expect(prepareFileUrlIds(withDupes)).toHaveLength(25);
  });

  it('fails loud past the concurrent-IO safety ceiling', () => {
    const ids = Array.from(
      { length: MAX_FILE_URL_IDS + 1 },
      (_, i) => `id_${i}`,
    );
    expect(() => prepareFileUrlIds(ids)).toThrow(
      /concurrent-IO safety ceiling/,
    );
  });

  it('accepts exactly the safety ceiling', () => {
    const ids = Array.from({ length: MAX_FILE_URL_IDS }, (_, i) => `id_${i}`);
    expect(prepareFileUrlIds(ids)).toHaveLength(MAX_FILE_URL_IDS);
  });
});
