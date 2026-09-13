// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { indexingStateFrom } from './indexing-state.ts';

/**
 * One reading of the indexing columns for three surfaces (REST `indexing`,
 * the agent listing, the chat fetch's miss). What is pinned: the opt-out
 * wins over a stale status column, a never-queued file is `pending`, and
 * the optional columns ride only when the row carries them.
 */
describe('indexingStateFrom', () => {
  it('reads a persisted opt-out as skipped whatever the status column says', () => {
    expect(
      indexingStateFrom({ skipRagIndexing: true, ragStatus: null }).status,
    ).toBe('skipped');
    // A REST-bound file that was later queued by hand still carries the
    // sticky opt-out — the opt-out is the fact the indexer honours.
    expect(
      indexingStateFrom({ skipRagIndexing: true, ragStatus: 'queued' }).status,
    ).toBe('skipped');
  });

  it('reads a file nobody queued and nobody opted out as pending', () => {
    expect(
      indexingStateFrom({ skipRagIndexing: null, ragStatus: null }).status,
    ).toBe('pending');
    expect(
      indexingStateFrom({ skipRagIndexing: false, ragStatus: 'mystery' })
        .status,
    ).toBe('pending');
  });

  it.each(['queued', 'running', 'completed', 'failed', 'unsupported'] as const)(
    'passes the %s status through',
    (status) => {
      expect(
        indexingStateFrom({ skipRagIndexing: false, ragStatus: status }).status,
      ).toBe(status);
    },
  );

  it('carries the timestamp and the error only when the row has them', () => {
    expect(
      indexingStateFrom({
        skipRagIndexing: false,
        ragStatus: 'failed',
        ragIndexedAt: null,
        ragError: 'Embedding provider refused',
        ragErrorCode: 'embedding_provider_refused',
      }),
    ).toEqual({
      status: 'failed',
      error: 'Embedding provider refused',
      errorCode: 'embedding_provider_refused',
    });
    expect(
      indexingStateFrom({
        skipRagIndexing: false,
        ragStatus: 'completed',
        ragIndexedAt: 1_700_000_000_000,
      }),
    ).toEqual({ status: 'completed', indexedAt: 1_700_000_000_000 });
    // A reader that selected no optional column gets no optional key.
    expect(
      indexingStateFrom({ skipRagIndexing: false, ragStatus: 'completed' }),
    ).toEqual({ status: 'completed' });
  });
});
