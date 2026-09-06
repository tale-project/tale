// @vitest-environment node

/**
 * Every status write the ingest orchestrator makes is a CAS on the phase it
 * owns — the two it did NOT guard were the yt-dlp failure paths: the retry
 * re-queue in `handleYtDlpError` and the terminal `fail()`. Both run right
 * after a yt-dlp call (up to 90 s for metadata, 15 min for audio), exactly
 * where a cancel (`skipped`) or a watchdog flip (`failed`) lands. An
 * unconditional write there resurrected a dismissed chip as 'retrying'
 * (consuming an in-flight slot and yt-dlp budget) or re-armed a cancelled
 * one with a Retry button. Both now CAS on the owned phase, and a lost CAS
 * writes and schedules nothing more.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCtxShim } from '../../lib/ctx-shim.ts';
import { ingestVideoLinkImpl } from './ingest_video_link';
import { YtDlpError } from './ytdlp';

const ytdlpJson = vi.fn<() => Promise<never>>();

vi.mock('./ytdlp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ytdlp')>();
  return {
    ...actual,
    createJobDir: vi.fn(() =>
      Promise.resolve({
        jobDir: '/tmp/vlink-cas-test',
        cleanup: () => Promise.resolve(),
      }),
    ),
    ytdlpJson: (...args: unknown[]) => ytdlpJson(...(args as [])),
    ytdlpWriteSubs: vi.fn(),
    ytdlpExtractAudio: vi.fn(),
  };
});
vi.mock('./url_safety', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./url_safety')>();
  return { ...actual, assertSafeUrl: vi.fn(() => Promise.resolve()) };
});
vi.mock('../lib/helpers/org_slug', () => ({
  orgSlugFromIdOrNull: vi.fn(() => Promise.resolve(null)),
}));

interface Row {
  id: string;
  organizationId: string;
  threadId: null;
  uploadedBy: string;
  sourceUrl: string;
  sourceUrlHash: string;
  sourcePlatform: string;
  status: string;
  attempts: number;
  errorReasonCode: string | null;
}

interface UpdateCall {
  status?: string;
  expectedStatus?: string;
  attempts?: number;
}

/**
 * One in-memory job row behind the shim: `getJobById` reads it, `updateJob`
 * applies the same CAS the real service does (`expectedStatus` absent →
 * unconditional), and the scheduler records what would have been enqueued.
 */
function harness(): {
  row: Row;
  ctx: never;
  updates: UpdateCall[];
  scheduled: { name: string; delayMs: number }[];
} {
  const row: Row = {
    id: 'job-1',
    organizationId: 'org-1',
    threadId: null,
    uploadedBy: 'user-1',
    sourceUrl: 'https://www.youtube.com/watch?v=abc',
    sourceUrlHash: 'h',
    sourcePlatform: 'youtube',
    status: 'queued',
    attempts: 0,
    errorReasonCode: null,
  };
  const updates: UpdateCall[] = [];
  const scheduled: { name: string; delayMs: number }[] = [];
  const ctx = createCtxShim(
    {
      'video_links/internal_queries:getJobById': () =>
        Promise.resolve({ ...row }),
      'video_links/internal_mutations:updateJob': (raw) => {
        const args = raw as UpdateCall & { errorReasonCode?: string };
        updates.push(args);
        if (
          args.expectedStatus !== undefined &&
          row.status !== args.expectedStatus
        ) {
          return Promise.resolve('cas_miss');
        }
        if (args.status !== undefined) row.status = args.status;
        if (args.attempts !== undefined) row.attempts = args.attempts;
        if (args.errorReasonCode !== undefined) {
          row.errorReasonCode = args.errorReasonCode;
        }
        return Promise.resolve('ok');
      },
      'browser_sessions/sessions:claimBrowserSession': () =>
        Promise.resolve(null),
    },
    {
      scheduler: (name, delayMs) => {
        scheduled.push({ name, delayMs });
        return Promise.resolve();
      },
    },
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the orchestrator's ActionCtx surface is what the shim provides (see runVideoIngestJob)
  return { row, ctx: ctx as never, updates, scheduled };
}

/** yt-dlp fails AFTER the row moved on: the cancel (or watchdog) landed
 *  during the call, so the row is `status` by the time the error surfaces. */
function ytdlpFailsAfterRowBecame(
  row: Row,
  status: string,
  err: YtDlpError,
): void {
  ytdlpJson.mockImplementationOnce(() => {
    row.status = status;
    return Promise.reject(err);
  });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('ingestVideoLinkImpl yt-dlp failure paths CAS on the owned phase', () => {
  it('does not resurrect a cancelled job as a retry', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = harness();
    ytdlpFailsAfterRowBecame(
      h.row,
      'skipped',
      new YtDlpError('transient', 'boom', 'ERROR: network'),
    );

    await ingestVideoLinkImpl(h.ctx, { jobId: 'job-1' });

    expect(h.row.status).toBe('skipped');
    expect(h.row.attempts).toBe(0);
    const requeue = h.updates.find((u) => u.status === 'queued');
    expect(requeue?.expectedStatus).toBe('fetching_metadata');
    // A lost CAS schedules neither the cleanup nor the retry.
    expect(h.scheduled).toEqual([]);
    expect(
      warn.mock.calls.some(([line]) =>
        String(line).includes('"event":"video_link.state_lost"'),
      ),
    ).toBe(true);
  });

  it('does not overwrite a cancelled job with a fresh failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = harness();
    ytdlpFailsAfterRowBecame(
      h.row,
      'skipped',
      new YtDlpError('geoblocked', 'blocked', 'ERROR: not available'),
    );

    await ingestVideoLinkImpl(h.ctx, { jobId: 'job-1' });

    expect(h.row.status).toBe('skipped');
    expect(h.row.errorReasonCode).toBeNull();
    const failWrite = h.updates.find((u) => u.status === 'failed');
    expect(failWrite?.expectedStatus).toBe('fetching_metadata');
    expect(h.scheduled).toEqual([]);
    expect(
      warn.mock.calls.some(([line]) =>
        String(line).includes('"event":"video_link.state_lost"'),
      ),
    ).toBe(true);
  });

  it('still re-queues, cleans up and reschedules when the row is its own', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = harness();
    ytdlpJson.mockImplementationOnce(() =>
      Promise.reject(new YtDlpError('transient', 'boom', 'ERROR: network')),
    );

    await ingestVideoLinkImpl(h.ctx, { jobId: 'job-1' });

    expect(h.row.status).toBe('queued');
    expect(h.row.attempts).toBe(1);
    expect(h.row.errorReasonCode).toBe('transient');
    expect(h.scheduled.map((s) => s.name)).toEqual([
      'video_links/internal_mutations:cleanupCancelledVideoLink',
      'video_links/ingest_video_link:ingestVideoLink',
    ]);
    expect(h.scheduled[1]?.delayMs).toBe(30_000);
  });
});
