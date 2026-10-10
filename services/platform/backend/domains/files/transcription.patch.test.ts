/**
 * A transcription's terminal write: a completion never lands on a recording
 * that was removed (`skipped`) while it was transcribed — and a video link
 * that handed its audio over is then left as the removal settled it. A
 * failure carries its code to that video link, so a reached usage limit
 * reads as one there.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { settleHandoffJobsByStorageRef } = vi.hoisted(() => ({
  settleHandoffJobsByStorageRef: vi.fn(async () => undefined),
}));
vi.mock('../video_links/service.ts', () => ({ settleHandoffJobsByStorageRef }));
vi.mock('../chat/shim.ts', () => ({ chatShimHandlers: () => ({}) }));

const { transcriptionHandlers } = await import('./transcription.ts');

/** A file row in `status`: an UPDATE answers it unless its guard holds it
 * back (a completion over a removal). */
function fakeSql(status: string): Sql {
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    if (text.includes('UPDATE app.file_metadata SET')) {
      const completing = values.includes('completed');
      return Promise.resolve(
        completing && status === 'skipped' ? [] : [{ id: 'file-1' }],
      );
    }
    return Promise.resolve([]);
  };
  const sql = Object.assign(tag, {
    unsafe: (text: string) => text,
    begin: async (work: (tx: unknown) => Promise<unknown>) => work(sql),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return sql as unknown as Sql;
}

const update = (sql: Sql, patch: Record<string, unknown>) =>
  transcriptionHandlers(sql)[
    'file_metadata/internal_mutations:updateFileTranscription'
  ]?.({ storageId: 's3:org/rec', ...patch });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('updateFileTranscription', () => {
  it('lands no completion on a recording removed while it was transcribed', async () => {
    await update(fakeSql('skipped'), {
      transcriptionStatus: 'completed',
      transcript: 'Hello.',
    });
    expect(settleHandoffJobsByStorageRef).not.toHaveBeenCalled();
  });

  it('settles the video link of a finished transcription', async () => {
    const sql = fakeSql('running');
    await update(sql, { transcriptionStatus: 'completed', transcript: 'Hi.' });
    expect(settleHandoffJobsByStorageRef).toHaveBeenCalledWith(sql, {
      storageId: 's3:org/rec',
      transcriptionStatus: 'completed',
    });
  });

  it('hands a failure’s code to its video link', async () => {
    const sql = fakeSql('running');
    await update(sql, {
      transcriptionStatus: 'failed',
      transcriptionError: 'Usage limit reached.',
      transcriptionErrorCode: 'budgetExceeded',
    });
    expect(settleHandoffJobsByStorageRef).toHaveBeenCalledWith(sql, {
      storageId: 's3:org/rec',
      transcriptionStatus: 'failed',
      errorMessage: 'Usage limit reached.',
      reasonCode: 'budgetExceeded',
    });
  });
});
