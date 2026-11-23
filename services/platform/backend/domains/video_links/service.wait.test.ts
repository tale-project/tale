// @vitest-environment node

/**
 * A video's job, between the queue and the lane (tale-project/tale#4942).
 * The lane schedules itself: to retry, and to come back from a wait for a
 * sandbox session, which it does knowing since when it waits and as what
 * it asked. Both ride the job's payload out to the queue and back in. A
 * hop that dropped them would start the wait anew each time: the video
 * would never have waited its quarter of an hour, and never fail.
 */

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { ingestVideoLinkImpl, addJobInTx } = vi.hoisted(() => ({
  ingestVideoLinkImpl: vi.fn(),
  addJobInTx: vi.fn(async () => {}),
}));

vi.mock('../../core/video_links/ingest_video_link.ts', () => ({
  ingestVideoLinkImpl,
}));
vi.mock('../../jobs/enqueue.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../jobs/enqueue.ts')>()),
  addJobInTx,
}));

import { internal } from '../../core/lib/handler_names';
import { runVideoIngestJob } from './service.ts';

const SQL = {} as Sql;
const KEY = '0b9d2c1e-5f1a-4c57-9d0e-0f6c2f6f1a11';
const NOW = 1_800_000_000_000;

interface Scheduling {
  scheduler: {
    runAfter(delayMs: number, ref: unknown, args: unknown): Promise<void>;
  };
}

/** The lane, replaced: it schedules itself once with `args` after
 * `delayMs`, as the real one does to retry or to wait. */
function laneSchedules(delayMs: number, args: Record<string, unknown>): void {
  ingestVideoLinkImpl.mockImplementation(async (ctx: Scheduling) => {
    await ctx.scheduler.runAfter(
      delayMs,
      internal.video_links.ingest_video_link.ingestVideoLink,
      args,
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a video’s job on its way into the lane', () => {
  it('is a first attempt with the job alone', async () => {
    ingestVideoLinkImpl.mockResolvedValue(undefined);

    await runVideoIngestJob(SQL, { jobId: 'job-1' });

    expect(ingestVideoLinkImpl).toHaveBeenCalledTimes(1);
    expect(ingestVideoLinkImpl.mock.calls[0]?.[1]).toEqual({ jobId: 'job-1' });
  });

  it('brings since when the video waits for a session, and as what it asked', async () => {
    ingestVideoLinkImpl.mockResolvedValue(undefined);

    await runVideoIngestJob(SQL, {
      jobId: 'job-1',
      userLocale: 'de',
      waitingSince: NOW - 40_000,
      waitingAs: KEY,
    });

    expect(ingestVideoLinkImpl.mock.calls[0]?.[1]).toEqual({
      jobId: 'job-1',
      userLocale: 'de',
      waitingSince: NOW - 40_000,
      waitingAs: KEY,
    });
  });
});

describe('a video’s job on its way back to the queue', () => {
  it('waits for a session as a job that says since when, and as what it asked', async () => {
    laneSchedules(20_000, {
      jobId: 'job-1',
      userLocale: 'de',
      waitingSince: NOW - 40_000,
      waitingAs: KEY,
    });

    await runVideoIngestJob(SQL, { jobId: 'job-1' });

    expect(addJobInTx).toHaveBeenCalledExactlyOnceWith(
      SQL,
      'video.ingest',
      {
        jobId: 'job-1',
        userLocale: 'de',
        waitingSince: NOW - 40_000,
        waitingAs: KEY,
      },
      { startAfter: new Date(NOW + 20_000) },
    );
  });

  it('is retried as a job that waits for nothing', async () => {
    laneSchedules(30_000, { jobId: 'job-1', userLocale: undefined });

    await runVideoIngestJob(SQL, {
      jobId: 'job-1',
      waitingSince: NOW - 40_000,
      waitingAs: KEY,
    });

    // A new attempt: its wait, if it comes to one, begins with it.
    expect(addJobInTx).toHaveBeenCalledExactlyOnceWith(
      SQL,
      'video.ingest',
      { jobId: 'job-1' },
      { startAfter: new Date(NOW + 30_000) },
    );
  });

  it('comes back at once where the lane asks for no delay', async () => {
    laneSchedules(0, { jobId: 'job-1' });

    await runVideoIngestJob(SQL, { jobId: 'job-1' });

    expect(addJobInTx).toHaveBeenCalledExactlyOnceWith(
      SQL,
      'video.ingest',
      { jobId: 'job-1' },
      {},
    );
  });
});
