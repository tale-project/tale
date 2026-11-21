// @vitest-environment node

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { transcribeAudioImpl } from '../../core/file_metadata/transcribe_audio.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { queueTranscription, runTranscribeJob } from './transcription.ts';

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
vi.mock('../../core/file_metadata/transcribe_audio.ts', () => ({
  transcribeAudioImpl: vi.fn(async () => null),
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

describe('runTranscribeJob', () => {
  const payload = {
    storageId: 's3:org-1/audio.wav',
    fileName: 'audio.wav',
    contentType: 'audio/wav',
    organizationId: 'org-1',
  };

  beforeEach(() => {
    vi.mocked(transcribeAudioImpl).mockClear();
  });

  // The recording is converted in the heavy slot, where it may wait its
  // turn: a job pg-boss gives up on must leave that line.
  it('hands its job’s cancel to the pipeline, with the job as it was queued', async () => {
    const job = new AbortController();
    await runTranscribeJob(fakeSql([]).sql, payload, { signal: job.signal });

    expect(transcribeAudioImpl).toHaveBeenCalledTimes(1);
    const [, handed, work] = vi.mocked(transcribeAudioImpl).mock.calls[0] ?? [];
    expect(handed).toEqual(payload);
    expect(work).toEqual({ signal: job.signal });
  });

  it('runs with no cancel where its caller has none', async () => {
    await runTranscribeJob(fakeSql([]).sql, payload);
    expect(vi.mocked(transcribeAudioImpl).mock.calls[0]?.[2]).toEqual({});
  });
});
