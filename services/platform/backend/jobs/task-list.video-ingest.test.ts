/**
 * The `video.ingest` job hands its whole payload to the lane: a video that
 * waits for a sandbox session comes back as a job that says since when it
 * waits and as what it asked (tale-project/tale#4942). A handler that
 * dropped either would start the wait anew each time the job came back: the
 * video would never have waited its quarter of an hour, and never fail.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runVideoIngestJob } = vi.hoisted(() => ({
  runVideoIngestJob: vi.fn(async () => {}),
}));

vi.mock('../domains/video_links/service.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../domains/video_links/service.ts')
  >()),
  runVideoIngestJob,
}));

import { createTaskList } from './task-list.ts';

const SQL = {} as Sql;
const KEY = '0b9d2c1e-5f1a-4c57-9d0e-0f6c2f6f1a11';

describe('video.ingest', () => {
  beforeEach(() => vi.clearAllMocks());
  const run = async (payload: unknown): Promise<void> => {
    const handler = createTaskList({ sql: SQL })['video.ingest'];
    expect(handler).toBeDefined();
    await handler?.(payload, { signal: new AbortController().signal });
  };

  it('runs a first attempt with the job alone', async () => {
    await run({ jobId: 'job-1' });

    expect(runVideoIngestJob).toHaveBeenCalledExactlyOnceWith(SQL, {
      jobId: 'job-1',
    });
  });

  it('hands on since when a video waits for a session, and as what it asked', async () => {
    await run({
      jobId: 'job-1',
      userLocale: 'de',
      waitingSince: 1_800_000_000_000,
      waitingAs: KEY,
    });

    expect(runVideoIngestJob).toHaveBeenCalledExactlyOnceWith(SQL, {
      jobId: 'job-1',
      userLocale: 'de',
      waitingSince: 1_800_000_000_000,
      waitingAs: KEY,
    });
  });

  it.each([
    [{ jobId: '' }],
    [{ jobId: 'job-1', waitingSince: -1 }],
    [{ jobId: 'job-1', waitingSince: 1.5 }],
    [{ jobId: 'job-1', waitingSince: '1800000000000' }],
    // A key is what the lane made: nothing else names a session.
    [{ jobId: 'job-1', waitingAs: '../other-session' }],
    [{ jobId: 'job-1', waitingAs: 42 }],
  ])('refuses a payload that is none of the lane’s: %j', async (payload) => {
    await expect(run(payload)).rejects.toThrow();
    expect(runVideoIngestJob).not.toHaveBeenCalled();
  });
});
