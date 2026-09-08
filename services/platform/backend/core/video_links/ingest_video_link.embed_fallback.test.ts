// @vitest-environment node

/**
 * Vimeo stopped serving watch pages to anonymous callers: every yt-dlp client
 * (verified on 2026.03.17, 2026.07.04 and 2026.08.19) comes back with a login
 * wall, while `player.vimeo.com/video/<id>` still serves the same public
 * video, captions included. Phase A now spends one extra spawn on that embed
 * form before giving up, and phases B and C follow the URL that worked —
 * while provenance keeps the link the user actually pasted.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCtxShim } from '../../lib/ctx-shim.ts';
import { ingestVideoLinkImpl } from './ingest_video_link';
import { YtDlpError, type YtDlpMetadata } from './ytdlp';

const WATCH_URL =
  'https://vimeo.com/1206142064?fl=wc&source_section=316&source_position=2';
const EMBED_URL = 'https://player.vimeo.com/video/1206142064';

/** The wall yt-dlp 2026.03.17 returns for a Vimeo watch page, verbatim. */
function loginWall(): YtDlpError {
  return new YtDlpError(
    'authRequired',
    'yt-dlp exited 1 (reason: authRequired)',
    'ERROR: [vimeo] 1206142064: Failed to fetch macos OAuth token: HTTP Error 401: Unauthorized',
  );
}

const ytdlpJson = vi.fn<(url: string) => Promise<YtDlpMetadata>>();
const ytdlpWriteSubs = vi.fn<(url: string) => Promise<string | null>>();
const ytdlpExtractAudio = vi.fn<(url: string) => Promise<string>>();

vi.mock('./ytdlp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ytdlp')>();
  return {
    ...actual,
    createJobDir: vi.fn(() =>
      Promise.resolve({
        jobDir: '/tmp/vlink-embed-test',
        cleanup: () => Promise.resolve(),
      }),
    ),
    ytdlpJson: (...args: unknown[]) => ytdlpJson(args[0] as string),
    ytdlpWriteSubs: (...args: unknown[]) => ytdlpWriteSubs(args[0] as string),
    ytdlpExtractAudio: (...args: unknown[]) =>
      ytdlpExtractAudio(args[0] as string),
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
  errorReasonCode?: string;
}

/** Same in-memory shim as `ingest_video_link.cas.test.ts`, on a Vimeo row. */
function harness(sourceUrl = WATCH_URL): {
  row: Row;
  ctx: never;
  updates: UpdateCall[];
} {
  const row: Row = {
    id: 'job-1',
    organizationId: 'org-1',
    threadId: null,
    uploadedBy: 'user-1',
    sourceUrl,
    sourceUrlHash: 'h',
    sourcePlatform: 'vimeo',
    status: 'queued',
    attempts: 0,
    errorReasonCode: null,
  };
  const updates: UpdateCall[] = [];
  const ctx = createCtxShim(
    {
      'video_links/internal_queries:getJobById': () =>
        Promise.resolve({ ...row }),
      'video_links/internal_mutations:updateJob': (raw) => {
        const args = raw as UpdateCall;
        updates.push(args);
        if (
          args.expectedStatus !== undefined &&
          row.status !== args.expectedStatus
        ) {
          return Promise.resolve('cas_miss');
        }
        if (args.status !== undefined) row.status = args.status;
        if (args.errorReasonCode !== undefined) {
          row.errorReasonCode = args.errorReasonCode;
        }
        return Promise.resolve('ok');
      },
      'browser_sessions/sessions:claimBrowserSession': () =>
        Promise.resolve(null),
    },
    { scheduler: () => Promise.resolve() },
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the orchestrator's ActionCtx surface is what the shim provides (see runVideoIngestJob)
  return { row, ctx: ctx as never, updates };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('the Vimeo embed fallback', () => {
  it('retries a walled watch page on the embed form and uses its metadata', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const h = harness();
    ytdlpJson.mockRejectedValueOnce(loginWall());
    // Over the 4h cap, so the run stops on a decision that could only have
    // been made from the fallback's metadata.
    ytdlpJson.mockResolvedValueOnce({
      title: 'WassupKaylee',
      duration: 20_000,
    } as YtDlpMetadata);

    await ingestVideoLinkImpl(h.ctx, { jobId: 'job-1' });

    expect(ytdlpJson.mock.calls.map(([url]) => url)).toEqual([
      WATCH_URL,
      EMBED_URL,
    ]);
    expect(h.row.status).toBe('failed');
    expect(h.row.errorReasonCode).toBe('videoTooLong');
  });

  it('points the caption and audio phases at the URL that worked', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = harness();
    ytdlpJson.mockRejectedValueOnce(loginWall());
    ytdlpJson.mockResolvedValueOnce({
      title: 'WassupKaylee',
      duration: 1193,
      // The track Vimeo's player actually advertises for this video.
      subtitles: { 'en-x-autogen': [] },
    } as unknown as YtDlpMetadata);
    // Captions miss → Phase C. Both spawns must carry the embed URL: the
    // watch URL is walled, so re-using it here would fail the whole ingest
    // one phase later than before.
    ytdlpWriteSubs.mockResolvedValueOnce(null);
    ytdlpExtractAudio.mockRejectedValueOnce(
      new YtDlpError('transient', 'boom', 'ERROR: network'),
    );

    await ingestVideoLinkImpl(h.ctx, { jobId: 'job-1' });

    expect(ytdlpWriteSubs).toHaveBeenCalledWith(EMBED_URL);
    expect(ytdlpExtractAudio).toHaveBeenCalledWith(EMBED_URL);
  });

  it("reports the watch page's own failure when the embed fails too", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = harness();
    ytdlpJson.mockRejectedValueOnce(loginWall());
    // A genuinely private video: the embed form is walled as well.
    ytdlpJson.mockRejectedValueOnce(
      new YtDlpError('unavailable', 'gone', 'ERROR: HTTP Error 404: Not Found'),
    );

    await ingestVideoLinkImpl(h.ctx, { jobId: 'job-1' });

    // The user pasted a watch URL, so the watch URL's reason is the one that
    // describes their link — not the fallback's 404 on a URL they never saw.
    expect(h.row.status).toBe('failed');
    expect(h.row.errorReasonCode).toBe('authRequired');
    expect(
      warn.mock.calls.some(([line]) =>
        String(line).includes('"event":"video_link.embed_fallback_missed"'),
      ),
    ).toBe(true);
  });

  it('spends no extra spawn where an embed form cannot help', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    // A platform with no walled-watch-page problem.
    const youtube = harness('https://www.youtube.com/watch?v=abc');
    ytdlpJson.mockRejectedValueOnce(
      new YtDlpError('unavailable', 'gone', 'ERROR: Video unavailable'),
    );
    await ingestVideoLinkImpl(youtube.ctx, { jobId: 'job-1' });
    expect(ytdlpJson).toHaveBeenCalledTimes(1);

    // Vimeo, but the failure is ours: a second spawn fails identically and
    // only doubles the phase cost.
    ytdlpJson.mockClear();
    const missingBinary = harness();
    ytdlpJson.mockRejectedValueOnce(
      new YtDlpError('binaryNotInstalled', 'no yt-dlp', ''),
    );
    await ingestVideoLinkImpl(missingBinary.ctx, { jobId: 'job-1' });
    expect(ytdlpJson).toHaveBeenCalledTimes(1);
  });
});
