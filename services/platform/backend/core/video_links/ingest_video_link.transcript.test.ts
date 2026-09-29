// @vitest-environment node

/**
 * The transcript a caption ingest stores, end to end through the worker:
 * metadata → track selection → the VTT on disk → `parseVtt` →
 * `rollingWindowDedup` → the paragraphizer → the stored blob and the
 * synthetic file row. yt-dlp is replaced at its module boundary (no process
 * runs) and the VTT is a fixed fixture, so the run is deterministic.
 *
 * A human track that times two speakers to the same start used to complete
 * with only the longer cue: the other speaker's line was gone from both the
 * blob and the file row, under a `captions_human` header (#3705).
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCtxShim } from '../../lib/ctx-shim.ts';
import { ingestVideoLinkImpl } from './ingest_video_link';
import type { YtDlpMetadata } from './ytdlp';

const fixture = vi.hoisted(() => ({
  jobDir: '',
  metadata: {} as YtDlpMetadata,
  vtt: '',
  blobs: [] as { bytes: Uint8Array; contentType: string }[],
}));

vi.mock('./ytdlp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ytdlp')>();
  return {
    ...actual,
    createJobDir: vi.fn(() =>
      Promise.resolve({
        jobDir: fixture.jobDir,
        cleanup: () => Promise.resolve(),
      }),
    ),
    ytdlpJson: vi.fn(() => Promise.resolve(fixture.metadata)),
    // What `yt-dlp --write-subs --convert-subs vtt` leaves in the job dir.
    ytdlpWriteSubs: vi.fn(
      async (_url: string, lang: string, jobDir: string) => {
        const path = join(jobDir, `track.${lang}.vtt`);
        await writeFile(path, fixture.vtt);
        return path;
      },
    ),
    ytdlpExtractAudio: vi.fn(() =>
      Promise.reject(new Error('the caption path must not extract audio')),
    ),
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
  putBlob: vi.fn((_org: string, bytes: Uint8Array, contentType: string) => {
    fixture.blobs.push({ bytes, contentType });
    return Promise.resolve(`s3:itest-org/blob-${fixture.blobs.length}`);
  }),
  deleteBlob: vi.fn(() => Promise.resolve()),
}));

interface FileRow {
  transcript: string;
  transcriptSource: string;
  storageId: string;
}

/**
 * One in-memory job behind the shim, with the service's CAS: `updateJob`
 * with an `expectedStatus` misses unless the row is in it, and the
 * synthetic-file finalizer lands only on an `indexing` row.
 */
function harness(): { ctx: never; row: { status: string }; files: FileRow[] } {
  const row = {
    id: 'job-1',
    organizationId: 'org-1',
    threadId: 'thread-1',
    uploadedBy: 'user-1',
    sourceUrl: 'https://www.youtube.com/watch?v=shipment01',
    sourceUrlHash: 'h',
    sourcePlatform: 'youtube',
    status: 'queued',
    attempts: 0,
  };
  const files: FileRow[] = [];
  const ctx = createCtxShim({
    'video_links/internal_queries:getJobById': () =>
      Promise.resolve({ ...row }),
    'video_links/internal_mutations:updateJob': (raw) => {
      const args = raw as { status?: string; expectedStatus?: string };
      if (
        args.expectedStatus !== undefined &&
        row.status !== args.expectedStatus
      ) {
        return Promise.resolve('cas_miss');
      }
      if (args.status !== undefined) row.status = args.status;
      return Promise.resolve('ok');
    },
    'video_links/internal_mutations:insertSyntheticFileMetadata': (raw) => {
      const args = raw as FileRow;
      if (row.status !== 'indexing') return Promise.resolve(null);
      files.push({
        transcript: args.transcript,
        transcriptSource: args.transcriptSource,
        storageId: args.storageId,
      });
      row.status = 'completed';
      return Promise.resolve('file-1');
    },
    'browser_sessions/sessions:claimBrowserSession': () =>
      Promise.resolve(null),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the orchestrator's ActionCtx surface is what the shim provides (see runVideoIngestJob)
  return { ctx: ctx as never, row, files };
}

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

beforeEach(async () => {
  fixture.jobDir = await mkdtemp(join(tmpdir(), 'vlink-transcript-test-'));
  fixture.blobs = [];
});

afterEach(async () => {
  await rm(fixture.jobDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('a caption ingest stores the whole track', () => {
  it('keeps both speakers of a human track who start at the same moment', async () => {
    fixture.metadata = {
      title: 'Shipment call',
      duration: 12,
      language: 'en',
      subtitles: { en: [{ ext: 'vtt' }] },
      automatic_captions: {},
    };
    fixture.vtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
<v Alice>The shipment is ready.</v>

00:00:01.000 --> 00:00:09.000
<v Bob>Hold the shipment until Monday.</v>
`;
    const { ctx, row, files } = harness();

    await ingestVideoLinkImpl(ctx, { jobId: 'job-1' as never });

    expect(row.status).toBe('completed');
    expect(files).toHaveLength(1);
    const [file] = files;
    expect(file?.transcriptSource).toBe('captions_human');
    expect(file?.transcript).toBe(
      '[00:00:01] Alice: The shipment is ready.\n\n' +
        '[00:00:01] Bob: Hold the shipment until Monday.',
    );
    // The blob carries the same words the file row does.
    expect(fixture.blobs).toHaveLength(1);
    expect(decode(fixture.blobs[0]?.bytes ?? new Uint8Array())).toBe(
      file?.transcript,
    );
  });

  it('still collapses an auto track that grows one line', async () => {
    fixture.metadata = {
      title: 'Shipment update',
      duration: 6,
      language: 'en',
      subtitles: {},
      automatic_captions: { en: [{ ext: 'vtt' }] },
    };
    fixture.vtt = `WEBVTT

00:00:00.500 --> 00:00:01.000
We

00:00:00.500 --> 00:00:02.000
We will

00:00:00.500 --> 00:00:03.000
We will ship Monday.
`;
    const { ctx, row, files } = harness();

    await ingestVideoLinkImpl(ctx, { jobId: 'job-1' as never });

    expect(row.status).toBe('completed');
    expect(files.map((file) => file.transcriptSource)).toEqual([
      'captions_auto',
    ]);
    expect(files[0]?.transcript).toBe('[00:00:00] We will ship Monday.');
  });
});
