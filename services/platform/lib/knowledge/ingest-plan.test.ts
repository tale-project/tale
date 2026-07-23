import { describe, expect, it } from 'vitest';

import {
  planIngest,
  sliceToStore,
  type IngestPlan,
  type StoredDocumentState,
} from './ingest-plan';

/**
 * The cases here are the ones that produced real damage: a half-indexed
 * document treated as finished (its tail unsearchable forever), and a resume
 * that restarted from zero (a large document that could never complete because
 * every attempt redid the last attempt's work).
 */

const HASH = 'sha256:aaa';
const OTHER_HASH = 'sha256:bbb';

function stored(
  overrides: Partial<StoredDocumentState> = {},
): StoredDocumentState {
  return {
    contentHash: HASH,
    status: 'completed',
    storedChunks: 10,
    ...overrides,
  };
}

describe('what to do with a document', () => {
  const cases: Array<[string, Parameters<typeof planIngest>[0], IngestPlan]> = [
    [
      'nothing stored yet',
      { contentHash: HASH, totalChunks: 10, stored: null },
      { action: 'index' },
    ],
    [
      'unchanged and complete',
      { contentHash: HASH, totalChunks: 10, stored: stored() },
      { action: 'skip', reason: 'unchanged' },
    ],
    [
      'unchanged but only partly committed',
      {
        contentHash: HASH,
        totalChunks: 10,
        stored: stored({ status: 'processing', storedChunks: 4 }),
      },
      { action: 'resume', fromChunk: 4 },
    ],
    [
      'stamped completed but short of the chunks the content produces',
      {
        contentHash: HASH,
        totalChunks: 12,
        stored: stored({ status: 'completed', storedChunks: 10 }),
      },
      { action: 'resume', fromChunk: 10 },
    ],
    [
      'the content changed',
      { contentHash: OTHER_HASH, totalChunks: 10, stored: stored() },
      { action: 'rewrite' },
    ],
    [
      'an earlier attempt failed before committing anything',
      {
        contentHash: HASH,
        totalChunks: 10,
        stored: stored({ status: 'failed', storedChunks: 0 }),
      },
      { action: 'rewrite' },
    ],
    [
      'identical content is already embedded elsewhere',
      {
        contentHash: HASH,
        totalChunks: 10,
        stored: null,
        duplicateOf: 'doc-uuid-1',
      },
      { action: 'clone', sourceDocumentId: 'doc-uuid-1' },
    ],
  ];

  it.each(cases)('%s', (_name, input, expected) => {
    expect(planIngest(input)).toEqual(expected);
  });

  it('finishes an interrupted slice instead of cloning over it', () => {
    // Cloning here would overwrite a prefix that is already correct, and the
    // clone's chunk boundaries need not match this document's.
    expect(
      planIngest({
        contentHash: HASH,
        totalChunks: 10,
        stored: stored({ status: 'processing', storedChunks: 6 }),
        duplicateOf: 'doc-uuid-1',
      }),
    ).toEqual({ action: 'resume', fromChunk: 6 });
  });

  it('never treats a processing row as finished, whatever its chunk count', () => {
    // The row is mid-slice; the number of committed chunks happens to equal the
    // total only because the previous attempt died just before stamping it.
    expect(
      planIngest({
        contentHash: HASH,
        totalChunks: 10,
        stored: stored({ status: 'processing', storedChunks: 10 }),
      }),
    ).toEqual({ action: 'resume', fromChunk: 10 });
  });

  it('discards a stored prefix when the content changed', () => {
    // New content has different chunk boundaries; keeping the old prefix would
    // splice two documents together.
    expect(
      planIngest({
        contentHash: OTHER_HASH,
        totalChunks: 10,
        stored: stored({ status: 'processing', storedChunks: 7 }),
      }),
    ).toEqual({ action: 'rewrite' });
  });
});

describe('slicing', () => {
  it('takes the first window of a fresh document', () => {
    expect(sliceToStore(100, 0, 30)).toEqual({ from: 0, to: 30, done: false });
  });

  it('resumes after the committed prefix', () => {
    expect(sliceToStore(100, 30, 30)).toEqual({
      from: 30,
      to: 60,
      done: false,
    });
  });

  it('reports the last window as done', () => {
    expect(sliceToStore(100, 90, 30)).toEqual({
      from: 90,
      to: 100,
      done: true,
    });
  });

  it('is done when everything is already committed', () => {
    expect(sliceToStore(100, 100, 30)).toEqual({
      from: 100,
      to: 100,
      done: true,
    });
  });

  it('never rewinds past the start or runs past the end', () => {
    expect(sliceToStore(10, -5, 4)).toEqual({ from: 0, to: 4, done: false });
    expect(sliceToStore(10, 99, 4)).toEqual({ from: 10, to: 10, done: true });
  });

  it('always advances by at least one chunk', () => {
    // A zero-sized slice would loop forever without committing anything.
    expect(sliceToStore(10, 0, 0)).toEqual({ from: 0, to: 1, done: false });
  });

  it('walks a whole document in slices without gaps or repeats', () => {
    const total = 47;
    const size = 10;
    let at = 0;
    const covered: number[] = [];
    for (let guard = 0; guard < 20; guard++) {
      const slice = sliceToStore(total, at, size);
      for (let i = slice.from; i < slice.to; i++) covered.push(i);
      at = slice.to;
      if (slice.done) break;
    }
    expect(covered).toEqual(Array.from({ length: total }, (_v, i) => i));
  });
});
