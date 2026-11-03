import { describe, expect, it } from 'vitest';

import { eventually } from './eventually.ts';

describe('eventually', () => {
  it('returns as soon as the condition holds', async () => {
    let polls = 0;
    await eventually(() => ++polls >= 3);
    expect(polls).toBe(3);
  });

  it('returns at once when the condition holds already', async () => {
    let polls = 0;
    await eventually(() => {
      polls += 1;
      return true;
    });
    expect(polls).toBe(1);
  });

  it('fails, saying what it waited for, when the condition never holds', async () => {
    await expect(
      eventually(() => false, { timeoutMs: 30, what: 'the socket to close' }),
    ).rejects.toThrow('timed out after 30 ms waiting for the socket to close');
  });

  it('names a plain condition when nothing else is said', async () => {
    await expect(eventually(() => false, { timeoutMs: 20 })).rejects.toThrow(
      'waiting for the condition',
    );
  });
});
