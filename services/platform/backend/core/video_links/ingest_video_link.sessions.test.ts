// @vitest-environment node

/**
 * The browser-session pool is keyed `(org, domain)` — a jar that cleared one
 * site's bot wall is worth reusing on that site and nowhere else. The ingest
 * used to ask for `youtube.com` on every job regardless of platform, so a
 * Vimeo or Bilibili run drew a jar yt-dlp could never send (the Netscape
 * cookie file is domain-scoped) and then, on hitting its OWN platform's wall,
 * reported the YouTube session burned. An unrelated site's block shrank the
 * pool that does the work.
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
        jobDir: '/tmp/vlink-session-test',
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

interface ClaimArgs {
  organizationId: string;
  domain: string;
}

/** Shim recording every session claim, with a healthy jar always on offer. */
function harness(sourcePlatform: string, sourceUrl: string) {
  const row = {
    id: 'job-1',
    organizationId: 'org-1',
    threadId: null,
    uploadedBy: 'user-1',
    sourceUrl,
    sourceUrlHash: 'h',
    sourcePlatform,
    status: 'queued',
    attempts: 0,
    errorReasonCode: null,
  };
  const claims: ClaimArgs[] = [];
  const reports: { outcome: string }[] = [];
  const failures: (string | undefined)[] = [];
  const ctx = createCtxShim(
    {
      'video_links/internal_queries:getJobById': () =>
        Promise.resolve({ ...row }),
      'video_links/internal_mutations:updateJob': (raw) => {
        const args = raw as {
          status?: string;
          expectedStatus?: string;
          errorReasonCode?: string;
        };
        if (
          args.expectedStatus !== undefined &&
          row.status !== args.expectedStatus
        ) {
          return Promise.resolve('cas_miss');
        }
        if (args.status !== undefined) row.status = args.status;
        if (args.status === 'failed') failures.push(args.errorReasonCode);
        return Promise.resolve('ok');
      },
      'browser_sessions/sessions:claimBrowserSession': (raw) => {
        claims.push(raw as ClaimArgs);
        // No jar on offer: the decrypt path is not what this file is about.
        return Promise.resolve(null);
      },
      'browser_sessions/sessions:reportBrowserSessionResult': (raw) => {
        reports.push(raw as { outcome: string });
        return Promise.resolve(null);
      },
    },
    { scheduler: () => Promise.resolve() },
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the orchestrator's ActionCtx surface is what the shim provides (see runVideoIngestJob)
  return { ctx: ctx as never, claims, reports, failures };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('the reason a bot check ends a video with', () => {
  const walled = () =>
    new YtDlpError('botDetection', 'walled', 'ERROR: not a bot');
  const run = async (platform: string, url: string) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = harness(platform, url);
    ytdlpJson.mockRejectedValueOnce(walled());
    await ingestVideoLinkImpl(h.ctx, { jobId: 'job-1' });
    return h.failures;
  };

  it('names the deployment’s setting for YouTube where no PO tokens are to be had', async () => {
    vi.stubEnv('VIDEO_INGEST_POT_PROVIDER', '');
    vi.stubEnv('VIDEO_INGEST_POT_PROVIDER_URL', '');
    vi.stubEnv('VIDEO_INGEST_PO_TOKEN', '');
    expect(await run('youtube', 'https://www.youtube.com/watch?v=abc')).toEqual(
      ['poTokenProviderOff'],
    );
  });

  it('is YouTube’s own wall where the deployment has a provider', async () => {
    vi.stubEnv('VIDEO_INGEST_POT_PROVIDER_URL', 'http://pot.example:4416');
    expect(await run('youtube', 'https://www.youtube.com/watch?v=abc')).toEqual(
      ['botDetection'],
    );
  });

  it('is the platform’s own wall anywhere else', async () => {
    vi.stubEnv('VIDEO_INGEST_POT_PROVIDER', '');
    vi.stubEnv('VIDEO_INGEST_POT_PROVIDER_URL', '');
    expect(
      await run('bilibili', 'https://www.bilibili.com/video/BV1xx'),
    ).toEqual(['botDetection']);
  });
});

describe('the browser-session claim', () => {
  it('asks for the domain of the platform being ingested', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    for (const [platform, url, domain] of [
      ['youtube', 'https://www.youtube.com/watch?v=abc', 'youtube.com'],
      ['bilibili', 'https://www.bilibili.com/video/BV1xx', 'bilibili.com'],
      ['twitch', 'https://www.twitch.tv/videos/123', 'twitch.tv'],
    ] as const) {
      const h = harness(platform, url);
      ytdlpJson.mockRejectedValueOnce(
        new YtDlpError('botDetection', 'walled', 'ERROR: not a bot'),
      );

      await ingestVideoLinkImpl(h.ctx, { jobId: 'job-1' });

      expect(h.claims).toEqual([{ organizationId: 'org-1', domain }]);
    }
  });

  it('claims nothing for a platform the pool cannot serve', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = harness('generic', 'https://example.com/video/1');
    ytdlpJson.mockRejectedValueOnce(
      new YtDlpError('unsupported', 'nope', 'ERROR: Unsupported URL'),
    );

    await ingestVideoLinkImpl(h.ctx, { jobId: 'job-1' });

    expect(h.claims).toEqual([]);
    // Nothing was claimed, so nothing may be reported burned either.
    expect(h.reports).toEqual([]);
  });
});
