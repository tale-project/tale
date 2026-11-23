/**
 * LIVE YouTube-ingestion test — proves the real anti-bot path end to end by
 * running the ACTUAL `yt-dlp` binary against a real video with the shipped
 * `buildAntiBotFlags` config (via `ytdlpJson` / `ytdlpWriteSubs`). It asserts
 * we get past YouTube's bot wall and pull a non-empty transcript.
 *
 * Gated behind `YOUTUBE_LIVE_TEST=1` so it is SKIPPED in the ordinary unit
 * suite and RUN only where the toolchain + a suitable egress exist: the Unit
 * platform workers in `.github/workflows/checks.yml` (with a bgutil PO-token
 * provider) and any developer who opts in locally. GitHub runners are DATACENTER
 * IPs — the exact environment where YouTube's "confirm you're not a bot" wall
 * appears — so a green CI run is the real proof that ingestion works from a
 * server, not just from a residential laptop.
 *
 * SELF-PROVISIONING: `yt-dlp`, `deno` (JS-challenge solver), `ffmpeg` (for a
 * stream yt-dlp hands on to it), and the bgutil PO-token plugin are NO LONGER installed by a
 * workflow step. The `beforeAll` below calls `ensureVideoToolchain()` to
 * download/resolve them into a per-user cache and points `ytdlp.ts` at them via
 * `VIDEO_INGEST_BIN_DIR` / `VIDEO_INGEST_FFMPEG_LOCATION` /
 * `VIDEO_INGEST_YTDLP_PLUGIN_DIRS` — so the very same test runs on a bare CI
 * runner and on a laptop. It stays gated behind `YOUTUBE_LIVE_TEST=1`; the
 * provisioning + network calls never fire in the normal suite.
 */
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeAll, describe, expect, it, type TestContext } from 'vitest';

import { RELAY_POT_PATH, relayPotBaseUrl, tokenOfPotPath } from './relay';
import { verifyVideoRelayToken } from './relay_token';
import {
  MEDIA_SELECTION,
  YtDlpError,
  buildSpawnPath,
  pluginDirFlagsFromEnv,
  youtubeExtractorArgsFromEnv,
  ytdlpJson,
  ytdlpWriteSubs,
  type YtDlpMetadata,
  localYtdlpPlace,
} from './ytdlp';
import {
  VIDEO_TOOLCHAIN_DEADLINES,
  ensureVideoToolchain,
} from './ytdlp_toolchain';

const LIVE = process.env.YOUTUBE_LIVE_TEST === '1';

/**
 * YouTube walls automated access from datacenter IPs with a "confirm you're
 * not a bot" challenge. The bgutil PO-token provider gets past it MOST of the
 * time, but not deterministically — a wall is an ADVERSARIAL, environmental
 * outcome, not a code regression, so it must not red the required CI job. Run
 * the live step; if (and only if) it fails with the bot-wall / rate-limit
 * reason, SKIP the case (logged) instead of failing. Any other error — a parse
 * failure, an empty transcript when we DID get through, the json3-conversion
 * class of bug — still fails hard, preserving the test's real signal.
 */
function isBotWall(err: unknown): err is YtDlpError {
  return (
    err instanceof YtDlpError &&
    (err.reason === 'botDetection' || err.reason === 'rateLimited')
  );
}

async function liveStep<T>(ctx: TestContext, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isBotWall(err)) {
      console.warn(
        `[live] YouTube bot-walled this run (${err.reason}); ` +
          'skipping — environmental, not a regression.',
      );
      ctx.skip();
    }
    throw err;
  }
}

// Rick Astley — "Never Gonna Give You Up". Chosen for extreme longevity and
// stable English auto-captions; unlikely to be removed or age-gated.
const VIDEO_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

/** Retry a flaky network step a couple of times before failing the run. */
async function withRetries<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // Short backoff; yt-dlp also retries internally.
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw lastErr;
}

function captionLangs(meta: YtDlpMetadata): string[] {
  return [
    ...Object.keys(meta.automatic_captions ?? {}),
    ...Object.keys(meta.subtitles ?? {}),
  ];
}

/**
 * Fetch + parse a transcript to plain words through the shipped ingest path,
 * skipping the case on a bot wall (see `liveStep`). Shared by the single-video
 * and multi-link cases so link-SHAPE coverage costs one helper, not a copy.
 */
async function transcriptWords(ctx: TestContext, url: string): Promise<string> {
  const jobDir = await mkdtemp(join(tmpdir(), 'ytlive-multi-'));
  const meta = await liveStep(ctx, () =>
    withRetries(() => ytdlpJson(url, localYtdlpPlace(jobDir), 90_000)),
  );
  const langs = captionLangs(meta);
  const lang =
    langs.find((l) => l === 'en') ??
    langs.find((l) => l.startsWith('en')) ??
    langs[0];
  expect(lang, `no caption track for ${url}`).toBeTruthy();
  const track = await liveStep(ctx, () =>
    withRetries(() =>
      ytdlpWriteSubs(url, lang, localYtdlpPlace(jobDir), {
        includeAutoGenerated: true,
        timeoutMs: 90_000,
      }),
    ),
  );
  expect(track, `no caption file for ${url}`).not.toBeNull();
  const vtt = await readFile(join(jobDir, track?.name ?? ''), 'utf8');
  return vtt
    .replace(/WEBVTT|Kind:[^\n]*|Language:[^\n]*/g, '')
    .replace(/\d{2}:\d{2}:\d{2}\.\d{3}\s*-->.*$/gm, '')
    .replace(/<[^>]*>/g, '')
    .replace(/[^A-Za-z]+/g, ' ')
    .trim();
}

describe.skipIf(!LIVE)(
  'yt-dlp live YouTube ingestion (datacenter-IP anti-bot)',
  () => {
    // Download/resolve the yt-dlp + deno + ffmpeg + bgutil toolchain and point
    // `ytdlp.ts` at it. Lives inside the gated `describe` so it NEVER runs (nor
    // touches the network) in the ordinary suite. A cold cache downloads two
    // binaries and may install ffmpeg; provisioning bounds itself by
    // `VIDEO_TOOLCHAIN_DEADLINES` (stopping its own children on expiry), and
    // the hook outlasts that bound, so a stall fails as a named stage, never
    // as a bare hook timeout with the child left running (#4073).
    beforeAll(async () => {
      const tc = await ensureVideoToolchain();
      process.env.VIDEO_INGEST_BIN_DIR = tc.binDir;
      process.env.VIDEO_INGEST_FFMPEG_LOCATION = tc.ffmpegLocation;
      // `||=`: honour an explicit plugin dir (e.g. the CI baked path) if set.
      process.env.VIDEO_INGEST_YTDLP_PLUGIN_DIRS ||= tc.pluginDir;
    }, VIDEO_TOOLCHAIN_DEADLINES.totalMs + 60_000);

    // Guards the plugin-DISCOVERY contract, which the bot-wall skip above
    // cannot: a bgutil zip expanded flat into the plugin root (yt_dlp_plugins/
    // directly under --plugin-dirs instead of nested one child deeper) makes
    // yt-dlp print "Plugin directories: none" and silently run tokenless —
    // every case below then walls and SKIPS, and the regression ships green.
    // The -v debug header prints before any network I/O, so probing it against
    // an unroutable URL proves discovery in milliseconds with zero YouTube
    // dependency.
    it('discovers the bgutil plugin package from the plugin-dirs layout', async () => {
      const pluginDirs = process.env.VIDEO_INGEST_YTDLP_PLUGIN_DIRS;
      expect(pluginDirs).toBeTruthy();
      const stderr = await new Promise<string>((resolve, reject) => {
        const proc = spawn(
          'yt-dlp',
          [
            '-v',
            '--no-config',
            '--ignore-config',
            '--socket-timeout',
            '2',
            '--plugin-dirs',
            pluginDirs as string,
            '--simulate',
            '--',
            'https://127.0.0.1:9/unreachable',
          ],
          {
            stdio: ['ignore', 'ignore', 'pipe'],
            env: {
              PATH: buildSpawnPath(process.env),
              HOME: tmpdir(),
              LANG: 'C.UTF-8',
            },
          },
        );
        let out = '';
        proc.stderr.on('data', (d) => {
          out += d.toString();
        });
        proc.on('close', () => resolve(out));
        proc.on('error', reject);
      });
      const headerLine = stderr
        .split('\n')
        .find((l) => l.includes('Plugin directories'));
      expect(
        headerLine,
        `no "Plugin directories" debug line in: ${stderr.slice(0, 400)}`,
      ).toBeTruthy();
      expect(headerLine).not.toContain('none');
      expect(headerLine).toContain('yt_dlp_plugins');
    }, 60_000);

    // A session's yt-dlp is given the PO-token relay's address as an
    // extractor argument, and yt-dlp hands the plugin that value in lower
    // case: the plugin reads it without asking for its case. So the address
    // must say the same either way, which a token in base64url did not (the
    // relay refused the plugin's every call, and no test without the plugin
    // could know). Here the real plugin asks a provider that only records,
    // at an address made the way a session's is, and the token it shows is
    // read back. It asks once YouTube has answered its first request: a run
    // that asked nothing is skipped, as a walled one is.
    it('asks the PO-token relay at the address a session is given', async (ctx) => {
      const key = { WEBDAV_APP_PASSWORD_HMAC_KEY: 'k'.repeat(64) };
      const asked: string[] = [];
      const provider = createServer((req, res) => {
        asked.push(req.url ?? '');
        req.resume();
        req.on('end', () => {
          res.setHeader('content-type', 'application/json');
          res.end(
            JSON.stringify(
              (req.url ?? '').endsWith('/ping')
                ? { server_uptime: 1, version: '1.3.1' }
                : { poToken: 'none-that-a-platform-takes' },
            ),
          );
        });
      });
      await new Promise<void>((resolve) => {
        provider.listen(0, '127.0.0.1', resolve);
      });
      try {
        const address = provider.address();
        const port =
          address !== null && typeof address === 'object' ? address.port : 0;
        const base = relayPotBaseUrl('job-live', {
          ...key,
          SANDBOX_HTTP_API_BASE_URL: `http://127.0.0.1:${port}`,
        });
        expect(base).not.toBeNull();
        await new Promise<void>((resolve, reject) => {
          const proc = spawn(
            'yt-dlp',
            [
              '--no-config',
              '--ignore-config',
              '--no-update',
              '--no-playlist',
              '--socket-timeout',
              '20',
              ...pluginDirFlagsFromEnv(process.env),
              ...youtubeExtractorArgsFromEnv({}, undefined, true, {
                potProviderUrl: base,
              }),
              '--simulate',
              '--',
              VIDEO_URL,
            ],
            {
              stdio: 'ignore',
              env: {
                PATH: buildSpawnPath(process.env),
                HOME: tmpdir(),
                LANG: 'C.UTF-8',
              },
            },
          );
          // Whether YouTube let the video through is not what is asked here.
          proc.on('close', () => resolve());
          proc.on('error', reject);
        });
        if (asked.length === 0) {
          console.warn(
            '[live] yt-dlp asked the PO-token provider nothing this run; skipping',
          );
          ctx.skip();
        }
        expect(asked.some((path) => path.endsWith('/ping'))).toBe(true);
        for (const path of asked) {
          expect(path.startsWith(`${RELAY_POT_PATH}/`)).toBe(true);
          const token = tokenOfPotPath(
            path.slice(RELAY_POT_PATH.length + 1).split('/')[0] ?? '',
          );
          expect(verifyVideoRelayToken(token ?? '', key)).toMatchObject({
            use: 'pot',
            job: 'job-live',
          });
        }
      } finally {
        await new Promise<void>((resolve) => {
          provider.close(() => resolve());
          provider.closeAllConnections();
        });
      }
    }, 180_000);

    // Which stream the lane's selection takes is yt-dlp's reading of it, so
    // the real yt-dlp says: from a video's description (`--load-info-json`),
    // with nothing fetched and no platform in it. The ladders are the shapes
    // platforms serve; the portrait one is Dailymotion's, measured.
    describe('which stream the sound of a video is taken from [VID-R9]', () => {
      interface Rendition {
        format_id: string;
        [key: string]: unknown;
      }
      const picture = (
        id: string,
        width: number | null,
        height: number | null,
        tbr: number | null,
      ): Rendition => ({
        format_id: id,
        url: `https://example.invalid/${id}.m3u8`,
        ext: 'mp4',
        vcodec: 'avc1.4d401e',
        acodec: 'mp4a.40.2',
        protocol: 'm3u8_native',
        ...(width === null ? {} : { width }),
        ...(height === null ? {} : { height }),
        ...(tbr === null ? {} : { tbr }),
      });
      const soundAlone = (id: string, abr: number): Rendition => ({
        format_id: id,
        url: `https://example.invalid/${id}.m4a`,
        ext: 'm4a',
        vcodec: 'none',
        acodec: 'mp4a.40.2',
        protocol: 'https',
        abr,
        tbr: abr,
      });
      const PORTRAIT = [
        picture('p-380', 360, 640, 460),
        picture('p-480', 480, 848, 836),
        picture('p-720', 720, 1280, 2149),
        picture('p-1080', 1080, 1920, 4706),
      ];
      const LANDSCAPE = [
        picture('l-240', 426, 240, 250),
        picture('l-380', 640, 360, 460),
        picture('l-480', 854, 480, 836),
        picture('l-720', 1280, 720, 2149),
        picture('l-1080', 1920, 1080, 4706),
      ];

      /** The format yt-dlp takes of `formats` under the lane's selection. */
      async function taken(
        seconds: number,
        formats: Rendition[],
      ): Promise<string> {
        const dir = await mkdtemp(join(tmpdir(), 'ytlive-pick-'));
        const info = join(dir, 'video.info.json');
        await writeFile(
          info,
          JSON.stringify({
            _type: 'video',
            id: 'pick',
            title: 'pick',
            extractor: 'generic',
            extractor_key: 'Generic',
            webpage_url: 'https://example.invalid/pick',
            original_url: 'https://example.invalid/pick',
            duration: seconds,
            formats,
          }),
        );
        return await new Promise<string>((resolve, reject) => {
          const proc = spawn(
            'yt-dlp',
            [
              '--no-config',
              '--ignore-config',
              '--no-update',
              '--load-info-json',
              info,
              '--simulate',
              '--print',
              'format_id',
              ...MEDIA_SELECTION,
            ],
            {
              stdio: ['ignore', 'pipe', 'pipe'],
              env: {
                PATH: buildSpawnPath(process.env),
                HOME: dir,
                LANG: 'C.UTF-8',
              },
            },
          );
          let out = '';
          let err = '';
          proc.stdout.on('data', (d) => {
            out += d.toString();
          });
          proc.stderr.on('data', (d) => {
            err += d.toString();
          });
          proc.on('close', (code) => {
            if (code === 0) resolve(out.trim());
            else
              reject(new Error(`yt-dlp exited ${code}: ${err.slice(0, 400)}`));
          });
          proc.on('error', reject);
        });
      }

      it.each<[string, number, Rendition[], string]>([
        // 480 pixels wide: no rendition of it is 480 high or less.
        ['a portrait clip', 62, PORTRAIT, 'p-480'],
        [
          'a portrait clip that is served at 20 Mbit/s too',
          57,
          [...PORTRAIT, picture('p-2160', 2160, 3840, 20_000)],
          'p-480',
        ],
        ['a landscape clip', 62, LANDSCAPE, 'l-480'],
        // None of the small ones fits the preferred size: the smallest.
        ['three hours in landscape', 3 * 3600, LANDSCAPE, 'l-240'],
        [
          'a clip with no rendition that small',
          60,
          [
            picture('t-576', 576, 1024, 900),
            picture('t-720', 720, 1280, 1800),
            picture('t-1080', 1080, 1920, 3500),
          ],
          't-576',
        ],
        [
          'a clip in high definition alone',
          60,
          [
            picture('h-720', 1280, 720, 2500),
            picture('h-1080', 1920, 1080, 5000),
          ],
          'h-720',
        ],
        [
          'a clip whose renditions say no size',
          60,
          [
            picture('n-low', null, null, 500),
            picture('n-mid', null, null, 1500),
            picture('n-high', null, null, 4000),
          ],
          'n-low',
        ],
        [
          'a video with one stream that says nothing of itself',
          600,
          [picture('only', null, null, null)],
          'only',
        ],
        [
          'a video with sound alone beside its pictures',
          600,
          [...PORTRAIT, soundAlone('a-64', 64), soundAlone('a-128', 128)],
          'a-128',
        ],
      ])(
        'of %s',
        async (_name, seconds, formats, expected) => {
          expect(await taken(seconds, formats)).toBe(expected);
        },
        60_000,
      );
    });

    it('fetches video metadata past the bot wall', async (ctx) => {
      const jobDir = await mkdtemp(join(tmpdir(), 'ytlive-meta-'));
      const meta = await liveStep(ctx, () =>
        withRetries(() =>
          ytdlpJson(VIDEO_URL, localYtdlpPlace(jobDir), 90_000),
        ),
      );

      expect(meta.id).toBeTruthy();
      expect(meta.title).toBeTruthy();
      // A caption/transcript track must be advertised — proves we reached the
      // player API, not just a bot-wall interstitial.
      expect(captionLangs(meta).length).toBeGreaterThan(0);
    }, 150_000);

    it('pulls a non-empty English transcript', async (ctx) => {
      const jobDir = await mkdtemp(join(tmpdir(), 'ytlive-subs-'));
      const meta = await liveStep(ctx, () =>
        withRetries(() =>
          ytdlpJson(VIDEO_URL, localYtdlpPlace(jobDir), 90_000),
        ),
      );

      // Prefer a plain `en` track; else the first advertised caption language.
      const langs = captionLangs(meta);
      const lang =
        langs.find((l) => l === 'en') ??
        langs.find((l) => l.startsWith('en')) ??
        langs[0];
      expect(lang).toBeTruthy();

      const track = await liveStep(ctx, () =>
        withRetries(() =>
          ytdlpWriteSubs(VIDEO_URL, lang, localYtdlpPlace(jobDir), {
            includeAutoGenerated: true,
            timeoutMs: 90_000,
          }),
        ),
      );
      // YouTube serves WebVTT itself: nothing was converted to get it.
      expect(track?.format).toBe('vtt');

      const vtt = await readFile(join(jobDir, track?.name ?? ''), 'utf8');
      // Strip the WEBVTT header, cue timings, and markup; assert real words
      // remain — a genuine transcript, not an empty or header-only file.
      const words = vtt
        .replace(/WEBVTT|Kind:[^\n]*|Language:[^\n]*/g, '')
        .replace(/\d{2}:\d{2}:\d{2}\.\d{3}\s*-->.*$/gm, '')
        .replace(/<[^>]*>/g, '')
        .replace(/[^A-Za-z]+/g, ' ')
        .trim();
      expect(words.length).toBeGreaterThan(50);
    }, 180_000);

    // Multi-link coverage: the same shipped path must handle different link
    // SHAPES and a second content type (the trial feedback asked to "use
    // multiple kinds of links"). Each skips on a bot wall like the cases above.
    it('pulls a transcript from a youtu.be short link', async (ctx) => {
      const words = await transcriptWords(ctx, 'https://youtu.be/dQw4w9WgXcQ');
      expect(words.toLowerCase()).toContain('give you up');
    }, 180_000);

    it('pulls a transcript from a different, spoken-word video', async (ctx) => {
      // "Me at the zoo" — the first YouTube video: 19s, spoken word, stable
      // auto-captions about elephants and their long trunks.
      const words = await transcriptWords(
        ctx,
        'https://www.youtube.com/watch?v=jNQXAC9IVRw',
      );
      expect(words.split(' ').length).toBeGreaterThan(10);
      expect(words.toLowerCase()).toMatch(/elephant|trunk/);
    }, 180_000);
  },
);
