// @vitest-environment node

/**
 * A video without captions, end to end through the worker: its sound goes
 * from where yt-dlp left it to the object store as it is read, and the
 * transcription lane is handed a file row for it. And a video for which no
 * sandbox session is to be had for now waits, which is none of its attempts
 * (tale-project/tale#4942). yt-dlp is replaced at its module boundary, and
 * the place its work is done in is a directory here.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCtxShim } from '../../lib/ctx-shim.ts';
import { orgSlugFromIdOrNull } from '../lib/helpers/org_slug';
import { SandboxLaneCapacityError } from '../node_only/sandbox/throwaway_session';
import { ingestVideoLinkImpl, SANDBOX_WAIT_MAX_MS } from './ingest_video_link';
import { YtDlpError, type YtDlpMetadata, type YtdlpMediaFile } from './ytdlp';

const fixture = vi.hoisted(() => ({
  jobDir: '',
  /** What opening the place does: the work, unless a test says otherwise. */
  open: null as null | (() => Promise<never>),
  /** What closing the place fails with after the work, where it does. */
  close: null as null | (() => Promise<never>),
  /** The key each run asked for its place under. */
  runKeys: [] as string[],
  /** What yt-dlp leaves for the sound, and names; `measured` where the
   * listing said another size than the file has when it is opened. */
  sound: null as null | {
    file: Omit<YtdlpMediaFile, 'size'>;
    bytes: Uint8Array;
    measured?: number;
  },
  /** What fetching the sound fails with, where it does. */
  soundError: null as null | (() => Error),
  /** Every transfer to the store: what was sent, as it was declared. */
  stored: [] as {
    org: string;
    bytes: number;
    contentLength: number;
    contentType: string;
  }[],
  /** The store's answer to a transfer. */
  store: null as null | (() => Promise<never>),
}));

vi.mock('./ytdlp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ytdlp')>();
  const metadata: YtDlpMetadata = {
    title: 'A talk without captions',
    duration: 1_800,
    subtitles: {},
    automatic_captions: {},
  };
  return {
    ...actual,
    ytdlpJson: vi.fn(() => Promise.resolve(metadata)),
    ytdlpWriteSubs: vi.fn(() => Promise.resolve(null)),
    ytdlpFetchAudio: vi.fn(async (_url: string, place: { dir: string }) => {
      if (fixture.soundError !== null) throw fixture.soundError();
      if (fixture.sound === null) {
        throw new actual.YtDlpError(
          'outputValidationFailed',
          'yt-dlp left no sound it was asked for',
          '',
        );
      }
      await writeFile(
        join(place.dir, fixture.sound.file.name),
        fixture.sound.bytes,
      );
      return {
        ...fixture.sound.file,
        size: fixture.sound.measured ?? fixture.sound.bytes.byteLength,
      };
    }),
  };
});
vi.mock('./session_place', async () => {
  const { localYtdlpPlace } =
    await vi.importActual<typeof import('./ytdlp')>('./ytdlp');
  return {
    inYtdlpPlace: async (
      _ctx: unknown,
      video: { runKey: string },
      work: (place: ReturnType<typeof localYtdlpPlace>) => Promise<unknown>,
    ) => {
      fixture.runKeys.push(video.runKey);
      if (fixture.open !== null) return await fixture.open();
      const here = localYtdlpPlace(fixture.jobDir);
      const done = await work({
        ...here,
        // As a session does: it opens no file of nothing, and refuses the
        // asking instead.
        openFile: (name, maxBytes) =>
          maxBytes > 0
            ? here.openFile(name, maxBytes)
            : Promise.reject(
                new Error('maxBytes must be a whole number of bytes above 0'),
              ),
      });
      if (fixture.close !== null) await fixture.close();
      return done;
    },
  };
});
vi.mock('./url_safety', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./url_safety')>();
  return { ...actual, assertSafeUrl: vi.fn(() => Promise.resolve()) };
});
vi.mock('../lib/helpers/org_slug', () => ({
  orgSlugFromIdOrNull: vi.fn(() => Promise.resolve('itest-org')),
}));
vi.mock('../lib/storage/blob_access', () => ({
  putBlob: vi.fn(() =>
    Promise.reject(new Error('the sound is never stored from memory')),
  ),
  putBlobStream: vi.fn(
    async (
      org: string,
      body: ReadableStream<Uint8Array>,
      args: { contentLength: number; contentType: string },
    ) => {
      if (fixture.store !== null) {
        await body.cancel();
        return await fixture.store();
      }
      let bytes = 0;
      for await (const chunk of body) bytes += chunk.byteLength;
      fixture.stored.push({ org, bytes, ...args });
      return `s3:itest-org/sound-${fixture.stored.length}`;
    },
  ),
  deleteBlob: vi.fn(() => Promise.resolve()),
}));

interface Row {
  status: string;
  attempts: number;
  errorReasonCode: string | null;
  errorMessage: string | null;
  storageId: string | null;
}

interface FileRow {
  storageId: string;
  fileName: string;
  contentType: string;
  size: number;
  source: string;
}

/** One in-memory job behind the shim, with the service's CAS. */
function harness(status = 'queued', attempts = 0) {
  const row: Row = {
    status,
    attempts,
    errorReasonCode: null,
    errorMessage: null,
    storageId: null,
  };
  const files: FileRow[] = [];
  const updates: Record<string, unknown>[] = [];
  const scheduled: { name: string; delayMs: number; args: unknown }[] = [];
  const ctx = createCtxShim(
    {
      'video_links/internal_queries:getJobById': () =>
        Promise.resolve({
          _id: 'job-1',
          organizationId: 'org-1',
          threadId: 'thread-1',
          uploadedBy: 'user-1',
          sourceUrl: 'https://www.youtube.com/watch?v=talk0001',
          sourceUrlHash: 'h',
          sourcePlatform: 'youtube',
          ...row,
        }),
      'video_links/internal_mutations:updateJob': (raw) => {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the orchestrator passes exactly this shape
        const args = raw as Partial<Row> & { expectedStatus?: string };
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
        if (args.errorMessage !== undefined)
          row.errorMessage = args.errorMessage;
        if (args.storageId !== undefined) row.storageId = args.storageId;
        return Promise.resolve('ok');
      },
      'file_metadata/internal_mutations:saveFileMetadata': (raw) => {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the orchestrator passes exactly this shape
        files.push(raw as FileRow);
        return Promise.resolve('file-1');
      },
      'browser_sessions/sessions:claimBrowserSession': () =>
        Promise.resolve(null),
    },
    {
      scheduler: (name, delayMs, args) => {
        scheduled.push({ name, delayMs, args });
        return Promise.resolve();
      },
    },
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the orchestrator's ActionCtx surface is what the shim provides (see runVideoIngestJob)
  return { ctx: ctx as never, row, files, updates, scheduled };
}

const RERUN = 'video_links/ingest_video_link:ingestVideoLink';
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a job id of the harness
const JOB = 'job-1' as never;

beforeEach(async () => {
  fixture.jobDir = await mkdtemp(join(tmpdir(), 'vlink-sound-test-'));
  fixture.open = null;
  fixture.close = null;
  fixture.runKeys = [];
  fixture.sound = null;
  fixture.soundError = null;
  fixture.stored = [];
  fixture.store = null;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  await rm(fixture.jobDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("a video's sound on its way to the transcription lane", () => {
  it('goes to the store as it is read, under the name and type it arrived in', async () => {
    fixture.sound = {
      file: {
        name: 'media.webm',
        extension: 'webm',
        contentType: 'audio/webm',
      },
      bytes: new Uint8Array(3 * 1024 * 1024).fill(7),
    };
    const { ctx, row, files } = harness();

    await ingestVideoLinkImpl(ctx, { jobId: JOB });

    // Every byte, and declared as many before the first of them.
    expect(fixture.stored).toEqual([
      {
        org: 'itest-org',
        bytes: 3 * 1024 * 1024,
        contentLength: 3 * 1024 * 1024,
        contentType: 'audio/webm',
      },
    ]);
    expect(files).toEqual([
      expect.objectContaining({
        storageId: 's3:itest-org/sound-1',
        fileName: 'A talk without captions.webm',
        contentType: 'audio/webm',
        size: 3 * 1024 * 1024,
        source: 'video_link',
      }),
    ]);
    expect(row.status).toBe('transcribing_handoff');
    expect(row.storageId).toBe('s3:itest-org/sound-1');
  });

  it.each([
    [{ name: 'media.m4a', extension: 'm4a', contentType: 'audio/mp4' }],
    [{ name: 'media.mp4', extension: 'mp4', contentType: 'video/mp4' }],
  ])('keeps whatever container the platform served: %j', async (file) => {
    fixture.sound = { file, bytes: new Uint8Array(64).fill(1) };
    const { ctx, files } = harness();

    await ingestVideoLinkImpl(ctx, { jobId: JOB });

    expect(files[0]).toMatchObject({
      fileName: `A talk without captions.${file.extension}`,
      contentType: file.contentType,
      size: 64,
    });
    expect(fixture.stored[0]?.contentType).toBe(file.contentType);
  });

  it('fails a video whose sound yt-dlp left empty, and stores nothing', async () => {
    fixture.sound = {
      file: {
        name: 'media.webm',
        extension: 'webm',
        contentType: 'audio/webm',
      },
      bytes: new Uint8Array(0),
    };
    const { ctx, row, files } = harness();

    await ingestVideoLinkImpl(ctx, { jobId: JOB });

    expect(row.status).toBe('failed');
    expect(row.errorReasonCode).toBe('outputValidationFailed');
    expect(fixture.stored).toEqual([]);
    expect(files).toEqual([]);
  });

  it('fails a video whose sound the store would not take as a temporary problem', async () => {
    fixture.sound = {
      file: {
        name: 'media.webm',
        extension: 'webm',
        contentType: 'audio/webm',
      },
      bytes: new Uint8Array(64).fill(1),
    };
    fixture.store = () => Promise.reject(new Error('S3 PUT failed: 503'));
    const { ctx, row, files } = harness();

    await ingestVideoLinkImpl(ctx, { jobId: JOB });

    expect(row.status).toBe('failed');
    expect(row.errorReasonCode).toBe('transient');
    expect(row.errorMessage).toBe('S3 PUT failed: 503');
    expect(files).toEqual([]);
  });

  // The file is read as it was measured: the read is given the time that
  // size takes, and never passes on more than was counted.
  it('refuses a sound that grew after it was measured, and stores nothing', async () => {
    fixture.sound = {
      file: {
        name: 'media.webm',
        extension: 'webm',
        contentType: 'audio/webm',
      },
      bytes: new Uint8Array(4096).fill(1),
      measured: 1024,
    };
    const { ctx, row, files } = harness();

    await ingestVideoLinkImpl(ctx, { jobId: JOB });

    expect(row.status).toBe('failed');
    expect(row.errorReasonCode).toBe('outputValidationFailed');
    expect(fixture.stored).toEqual([]);
    expect(files).toEqual([]);
  });

  // The size of a video's sound is the video's own: a retry would fetch the
  // same bytes up to the same limit.
  it('fails a video whose sound is too large for good, on its first attempt', async () => {
    fixture.soundError = () =>
      new YtDlpError(
        'videoTooLarge',
        "the video's sound is larger than the 1073741824 bytes it may be: the platform declares more",
        '',
      );
    const { ctx, row, files, scheduled } = harness();

    await ingestVideoLinkImpl(ctx, { jobId: JOB });

    expect(row.status).toBe('failed');
    expect(row.errorReasonCode).toBe('videoTooLarge');
    expect(row.attempts).toBe(0);
    expect(scheduled).toEqual([]);
    expect(fixture.stored).toEqual([]);
    expect(files).toEqual([]);
  });

  it('fails a video yt-dlp left no sound for with its own reason', async () => {
    const { ctx, row } = harness();

    await ingestVideoLinkImpl(ctx, { jobId: JOB });

    expect(row.status).toBe('failed');
    expect(row.errorReasonCode).toBe('outputValidationFailed');
    expect(fixture.stored).toEqual([]);
  });
});

/**
 * The watchdog reads a row that has been queued for five minutes as one
 * nobody is working on, and a session may take minutes of those to start:
 * a run stamps the row as it takes it up.
 */
describe('a run that takes a video up', () => {
  it('writes its row queued again before it asks for a place', async () => {
    fixture.sound = {
      file: {
        name: 'media.webm',
        extension: 'webm',
        contentType: 'audio/webm',
      },
      bytes: new Uint8Array(64).fill(1),
    };
    const { ctx, updates } = harness();

    await ingestVideoLinkImpl(ctx, { jobId: JOB });

    expect(updates[0]).toEqual({
      jobId: 'job-1',
      status: 'queued',
      expectedStatus: 'queued',
    });
    expect(fixture.runKeys).toHaveLength(1);
  });

  it('asks for no place for a row that was cancelled since it read it', async () => {
    const { ctx, row, scheduled } = harness();
    // Cancelled between the run's look at the row and its taking it up.
    vi.mocked(orgSlugFromIdOrNull).mockImplementationOnce(() => {
      row.status = 'skipped';
      return Promise.resolve('itest-org');
    });

    await ingestVideoLinkImpl(ctx, { jobId: JOB });

    expect(row.status).toBe('skipped');
    expect(fixture.runKeys).toEqual([]);
    expect(scheduled).toEqual([]);
  });
});

describe('a video for which no sandbox session is to be had', () => {
  const busy = (retryAfterMs?: number) => () =>
    Promise.reject(
      new SandboxLaneCapacityError(
        'host',
        'the sandbox host is busy',
        retryAfterMs,
      ),
    );

  it('keeps its place in the queue, and its job comes back', async () => {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    fixture.open = busy();
    const { ctx, row, updates, scheduled } = harness();

    await ingestVideoLinkImpl(ctx, { jobId: JOB, userLocale: 'de' });

    // Still queued, and written so as the run took it up and again as it
    // went to wait: the watchdog reads a row that has been queued for five
    // minutes as one nobody is working on.
    expect(row.status).toBe('queued');
    expect(updates).toEqual([
      { jobId: 'job-1', status: 'queued', expectedStatus: 'queued' },
      { jobId: 'job-1', status: 'queued', expectedStatus: 'queued' },
    ]);
    // None of its attempts.
    expect(row.attempts).toBe(0);
    expect(fixture.runKeys).toHaveLength(1);
    expect(fixture.runKeys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(scheduled).toEqual([
      {
        name: RERUN,
        delayMs: 20_000,
        args: {
          jobId: 'job-1',
          userLocale: 'de',
          waitingSince: 1_800_000_000_000,
          // The key it asked under, to ask under again.
          waitingAs: fixture.runKeys[0],
        },
      },
    ]);
  });

  // The sandbox host keeps a first-come line of the session ids it refused.
  // A job that asked under a new id each time it came back would stand
  // behind its own earlier asks, and wait its quarter of an hour out with
  // room free.
  it('asks again under the key it waited under, and a new run under a new one', async () => {
    fixture.open = busy();
    const waiting = harness();
    await ingestVideoLinkImpl(waiting.ctx, { jobId: JOB });
    const again = waiting.scheduled[0]?.args as {
      waitingSince: number;
      waitingAs: string;
    };

    await ingestVideoLinkImpl(waiting.ctx, { jobId: JOB, ...again });
    await ingestVideoLinkImpl(harness().ctx, { jobId: JOB });

    expect(fixture.runKeys).toHaveLength(3);
    expect(fixture.runKeys[1]).toBe(fixture.runKeys[0]);
    expect(fixture.runKeys[2]).not.toBe(fixture.runKeys[0]);
    // And it goes on waiting under it.
    expect(waiting.scheduled[1]?.args).toMatchObject({
      waitingAs: fixture.runKeys[0],
    });
  });

  it.each([
    [undefined, 20_000],
    [1_000, 5_000],
    [12_000, 12_000],
    [600_000, 60_000],
  ])(
    'asks again when the host said its place comes up (%s ms), within bounds: %s ms',
    async (retryAfterMs, delayMs) => {
      fixture.open = busy(retryAfterMs);
      const { ctx, scheduled } = harness();

      await ingestVideoLinkImpl(ctx, { jobId: JOB });

      expect(scheduled.map((job) => job.delayMs)).toEqual([delayMs]);
    },
  );

  it('waits for a spent budget as it does for a busy host', async () => {
    fixture.open = () =>
      Promise.reject(
        new SandboxLaneCapacityError(
          'quota',
          "The organization's render sessions are all in use",
        ),
      );
    const { ctx, row, scheduled } = harness();

    await ingestVideoLinkImpl(ctx, { jobId: JOB });

    expect(row.status).toBe('queued');
    expect(scheduled).toHaveLength(1);
  });

  it('remembers when it began to wait, however often its job comes back', async () => {
    vi.useFakeTimers({ now: 1_800_000_300_000 });
    fixture.open = busy();
    const { ctx, scheduled } = harness();

    await ingestVideoLinkImpl(ctx, {
      jobId: JOB,
      waitingSince: 1_800_000_000_000,
    });

    expect(scheduled[0]?.args).toEqual({
      jobId: 'job-1',
      waitingSince: 1_800_000_000_000,
      waitingAs: fixture.runKeys[0],
    });
  });

  it('fails as a temporary problem once it has waited a quarter of an hour, and says what for', async () => {
    const since = 1_800_000_000_000;
    vi.useFakeTimers({ now: since + SANDBOX_WAIT_MAX_MS });
    fixture.open = busy();
    const { ctx, row, scheduled } = harness();

    await ingestVideoLinkImpl(ctx, { jobId: JOB, waitingSince: since });

    expect(SANDBOX_WAIT_MAX_MS).toBe(15 * 60_000);
    expect(row.status).toBe('failed');
    expect(row.errorReasonCode).toBe('transient');
    expect(row.errorMessage).toBe(
      'no sandbox session could be had for 15 minutes: the sandbox host is busy',
    );
    expect(scheduled).toEqual([]);
  });

  it('still waits a moment before the quarter of an hour is up', async () => {
    const since = 1_800_000_000_000;
    vi.useFakeTimers({ now: since + SANDBOX_WAIT_MAX_MS - 1 });
    fixture.open = busy();
    const { ctx, row, scheduled } = harness();

    await ingestVideoLinkImpl(ctx, { jobId: JOB, waitingSince: since });

    expect(row.status).toBe('queued');
    expect(scheduled).toHaveLength(1);
  });

  it('is not brought back once it was cancelled while it waited', async () => {
    fixture.open = busy();
    const { ctx, row, scheduled } = harness();
    // Cancelled between the run's first look at the row and its wait.
    const original = fixture.open;
    fixture.open = () => {
      row.status = 'skipped';
      return original();
    };

    await ingestVideoLinkImpl(ctx, { jobId: JOB });

    expect(row.status).toBe('skipped');
    expect(scheduled).toEqual([]);
  });

  it('takes a yt-dlp failure of the opening for an attempt, and not for a wait', async () => {
    fixture.open = () =>
      Promise.reject(new YtDlpError('transient', 'never thrown here', ''));
    const { ctx, row } = harness();

    await ingestVideoLinkImpl(ctx, { jobId: JOB });

    expect(row.status).toBe('queued');
    expect(row.attempts).toBe(1);
  });
});

/**
 * No place for the work: the sandbox could not be reached, or would not
 * start a session. Nothing of the video was tried and its row is still
 * `queued`; thrown on, the failure would leave it there until the watchdog
 * failed it five minutes later.
 */
describe('a video whose place could not be opened', () => {
  const CLEANUP = 'video_links/internal_mutations:cleanupCancelledVideoLink';
  const gone = () => Promise.reject(new Error('the spawner is gone'));

  it("is tried again as a temporary problem, after the first retry's wait", async () => {
    fixture.open = gone;
    const { ctx, row, updates, scheduled } = harness();

    await ingestVideoLinkImpl(ctx, { jobId: JOB });

    expect(row.status).toBe('queued');
    // One of its attempts, unlike a wait for a session.
    expect(updates).toEqual([
      { jobId: 'job-1', status: 'queued', expectedStatus: 'queued' },
      {
        jobId: 'job-1',
        status: 'queued',
        expectedStatus: 'queued',
        attempts: 1,
        errorReasonCode: 'transient',
        errorMessage: '',
      },
    ]);
    expect(scheduled).toEqual([
      { name: CLEANUP, delayMs: 0, args: { jobId: 'job-1' } },
      {
        name: RERUN,
        delayMs: 30_000,
        args: { jobId: 'job-1', userLocale: undefined },
      },
    ]);
  });

  // What it failed with names addresses of the deployment's own network:
  // the log's to keep, and a member reads the row.
  it('fails on its last attempt in words of its own, and tells the log why', async () => {
    fixture.open = () =>
      Promise.reject(
        new Error('sandbox spawner unreachable at http://sandbox:8003'),
      );
    const { ctx, row, scheduled } = harness('queued', 3);

    await ingestVideoLinkImpl(ctx, { jobId: JOB });

    expect(row.status).toBe('failed');
    expect(row.errorReasonCode).toBe('transient');
    expect(row.errorMessage).toBe(
      'no sandbox session could be opened to fetch the video in',
    );
    expect(scheduled).toEqual([]);
    const logged = vi
      .mocked(console.warn)
      .mock.calls.map((call) => String(call[0]));
    expect(
      logged.some(
        (line) =>
          line.includes('"event":"video_link.no_place"') &&
          line.includes('http://sandbox:8003'),
      ),
    ).toBe(true);
  });

  it('is left as another writer has it since', async () => {
    const { ctx, row, scheduled } = harness();
    fixture.open = () => {
      row.status = 'skipped';
      return gone();
    };

    await ingestVideoLinkImpl(ctx, { jobId: JOB });

    expect(row.status).toBe('skipped');
    expect(row.attempts).toBe(0);
    expect(scheduled).toEqual([]);
  });

  // What goes wrong once the work began is the work's own to tell, as it
  // always was: here the place would not close after a video that is done.
  it('tells a failure after the work began as the failure it is', async () => {
    fixture.sound = {
      file: {
        name: 'media.webm',
        extension: 'webm',
        contentType: 'audio/webm',
      },
      bytes: new Uint8Array(64).fill(1),
    };
    fixture.close = () => Promise.reject(new Error('the session would not go'));
    const { ctx, row, scheduled } = harness();

    await expect(ingestVideoLinkImpl(ctx, { jobId: JOB })).rejects.toThrow(
      'the session would not go',
    );
    // The video's own work stands.
    expect(row.status).toBe('transcribing_handoff');
    expect(row.attempts).toBe(0);
    expect(scheduled).toEqual([]);
  });
});
