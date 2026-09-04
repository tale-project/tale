// @vitest-environment node

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addJobInTx } from '../../jobs/enqueue.ts';
import { queueTranscription } from './transcription.ts';

/**
 * The regression under test: `queueTranscription` enqueued a
 * `files.transcribe` job unconditionally, even when its `queued` stamp
 * matched no row — a row already queued, running, or completed got a second
 * job with no work to do (the lease's status guard fences the bill, but the
 * job, the log line, and the intent were wrong). A job now follows only the
 * stamp that actually landed.
 */

vi.mock('../../jobs/enqueue.ts', () => ({
  addJobInTx: vi.fn(async () => 'job-1'),
}));

interface Captured {
  text: string;
  values: unknown[];
}

/** Tagged-template Sql double answering every statement with `rows`. */
function fakeSql(rows: object[]): { sql: Sql; queries: Captured[] } {
  const queries: Captured[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push({
      text: strings.join('$?').replace(/\s+/g, ' ').trim(),
      values,
    });
    return Promise.resolve(rows);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: tag as unknown as Sql, queries };
}

const args = {
  organizationId: 'org-1',
  storageRef: 's3:org-1/audio.wav',
  fileName: 'audio.wav',
  contentType: 'audio/wav',
};

describe('queueTranscription', () => {
  beforeEach(() => {
    vi.mocked(addJobInTx).mockClear();
  });

  it('stamps a fresh row queued and enqueues exactly one job', async () => {
    const { sql, queries } = fakeSql([{ id: 'file-1' }]);

    expect(await queueTranscription(sql, args)).toBe(true);

    expect(queries[0]?.text).toContain("transcription_status = 'queued'");
    expect(queries[0]?.text).toContain('transcription_status IS NULL');
    expect(queries[0]?.text).toContain('RETURNING id');
    expect(addJobInTx).toHaveBeenCalledTimes(1);
    expect(addJobInTx).toHaveBeenCalledWith(sql, 'files.transcribe', {
      storageId: args.storageRef,
      fileName: args.fileName,
      contentType: args.contentType,
      organizationId: args.organizationId,
    });
  });

  it('enqueues nothing for a row that already has a transcription lifecycle', async () => {
    const { sql } = fakeSql([]);

    expect(await queueTranscription(sql, args)).toBe(false);

    expect(addJobInTx).not.toHaveBeenCalled();
  });
});
