import { describe, expect, it } from 'vitest';

import {
  MEMORY_LIMIT_SETTING,
  memoryLimitOf,
  memoryLimitSentence,
} from './memory-limit';

describe('the sentence of a file that needs more memory than one file is given', () => {
  it('names the limit and the setting that raises it', () => {
    expect(MEMORY_LIMIT_SETTING).toBe('HEAVY_SLOT_MEMORY_MB');
    expect(memoryLimitSentence(96)).toBe(
      'This file needs more memory than the 96 MiB this server gives one file. An administrator can raise the limit with HEAVY_SLOT_MEMORY_MB.',
    );
  });

  it.each([64, 96, 512, 65536])('is read back as its limit (%i)', (limit) => {
    expect(memoryLimitOf(memoryLimitSentence(limit))).toBe(limit);
  });

  it('is recognised with what a lane wrote after it', () => {
    expect(
      memoryLimitOf(
        `${memoryLimitSentence(128)} Indexing can be retried then.`,
      ),
    ).toBe(128);
  });

  it.each([
    undefined,
    null,
    '',
    'Usage limit reached. The organization has spent its monthly budget.',
    'Indexing failed on the platform’s side; it is retried automatically.',
    // Not at the start: a sentence that quotes this one is not this one.
    `The read failed: ${memoryLimitSentence(96)}`,
    'This file needs more memory than the many MiB this server gives one file.',
  ])('is not seen in another failure (%s)', (text) => {
    expect(memoryLimitOf(text)).toBeUndefined();
  });
});
