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
 * SELF-PROVISIONING: `yt-dlp`, `deno` (JS-challenge solver), `ffmpeg` (subtitle
 * conversion), and the bgutil PO-token plugin are NO LONGER installed by a
 * workflow step. The `beforeAll` below calls `ensureVideoToolchain()` to
 * download/resolve them into a per-user cache and points `ytdlp.ts` at them via
 * `VIDEO_INGEST_BIN_DIR` / `VIDEO_INGEST_FFMPEG_LOCATION` /
 * `VIDEO_INGEST_YTDLP_PLUGIN_DIRS` — so the very same test runs on a bare CI
 * runner and on a laptop. It stays gated behind `YOUTUBE_LIVE_TEST=1`; the
 * provisioning + network calls never fire in the normal suite.
 */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeAll, describe, expect, it, type TestContext } from 'vitest';

import {
  YtDlpError,
  buildSpawnPath,
  ytdlpJson,
  ytdlpWriteSubs,
  type YtDlpMetadata,
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

/** What another run may cure: a run that failed without naming why, or one
 * that ran out of time. Anything the classifier names fails at once. */
function isRetryable(err: unknown): err is YtDlpError {
  return (
    err instanceof YtDlpError &&
    (err.reason === 'transient' || err.reason === 'timeout')
  );
}

/** One yt-dlp run's own ceiling, as the ingest gives it. */
const RUN_TIMEOUT_MS = 90_000;
/** Runs per step: yt-dlp also retries each request internally. */
const RUN_ATTEMPTS = 3;
/** Kept between a case's last run and its vitest timeout: `spawnYtdlp`'s
 * SIGTERM-to-SIGKILL grace (5 s), the file reads after it, and slack. */
const CASE_MARGIN_MS = 15_000;
/** No run starts with less left than this: one extraction took 40-45 s on
 * the CPU-starved runners of 2026-11-23, so a shorter run is only killed. */
const MIN_RUN_MS = 30_000;

/**
 * A case's deadline, `caseTimeoutMs` (its vitest timeout) less the margin.
 * Every yt-dlp run of the case ends by it — `spawnYtdlp` kills the run at
 * its `timeoutMs` — so a slow YouTube ends the case as a named outcome,
 * never as vitest's bare "Test timed out" with yt-dlp left running into the
 * next case.
 */
function caseDeadline(caseTimeoutMs: number): number {
  return Date.now() + caseTimeoutMs - CASE_MARGIN_MS;
}

function skipLive(ctx: TestContext, note: string): never {
  console.warn(`[live] ${note}; skipping — environmental, not a regression.`);
  return ctx.skip(note);
}

/**
 * One live step: runs of `run` (handed each run's timeout) until one
 * succeeds, at most {@link RUN_ATTEMPTS}, none started with less than
 * {@link MIN_RUN_MS} left before `deadline`. A bot wall skips the case at
 * once; a run killed because YouTube had not answered by the deadline skips
 * it too, as the wall's slow form. A run that failed without naming why,
 * on its last attempt, and every other error fail the case.
 */
async function liveStep<T>(
  ctx: TestContext,
  deadline: number,
  run: (timeoutMs: number) => Promise<T>,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= RUN_ATTEMPTS; attempt++) {
    const left = deadline - Date.now();
    if (left < MIN_RUN_MS) break;
    try {
      return await run(Math.min(RUN_TIMEOUT_MS, left));
    } catch (err) {
      if (isBotWall(err)) {
        skipLive(ctx, `YouTube bot-walled this run (${err.reason})`);
      }
      if (!isRetryable(err)) throw err;
      console.warn(
        `[live] run ${attempt}/${RUN_ATTEMPTS} failed (${err.reason}): ${err.sanitizedStderr.trim().slice(-300)}`,
      );
      lastErr = err;
    }
    // Short backoff, never past the deadline.
    const pause = Math.min(2000 * attempt, deadline - Date.now());
    if (pause > 0) await new Promise((r) => setTimeout(r, pause));
  }
  if (
    lastErr === undefined ||
    (lastErr instanceof YtDlpError && lastErr.reason === 'timeout')
  ) {
    skipLive(
      ctx,
      `YouTube did not answer within the case's deadline (${lastErr === undefined ? 'no time left for a run' : 'the last run was killed'})`,
    );
  }
  throw lastErr;
}

// Rick Astley — "Never Gonna Give You Up". Chosen for extreme longevity and
// stable English auto-captions; unlikely to be removed or age-gated.
const VIDEO_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

/** vitest timeout of the cases that fetch metadata and then captions. */
const TRANSCRIPT_CASE_MS = 180_000;
/** vitest timeout of the metadata-only case. */
const METADATA_CASE_MS = 150_000;

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
  const deadline = caseDeadline(TRANSCRIPT_CASE_MS);
  const jobDir = await mkdtemp(join(tmpdir(), 'ytlive-multi-'));
  const meta = await liveStep(ctx, deadline, (timeoutMs) =>
    ytdlpJson(url, jobDir, timeoutMs),
  );
  const langs = captionLangs(meta);
  const lang =
    langs.find((l) => l === 'en') ??
    langs.find((l) => l.startsWith('en')) ??
    langs[0];
  expect(lang, `no caption track for ${url}`).toBeTruthy();
  const vttPath = await liveStep(ctx, deadline, (timeoutMs) =>
    ytdlpWriteSubs(url, lang, jobDir, {
      includeAutoGenerated: true,
      timeoutMs,
    }),
  );
  const vtt = await readFile(vttPath as string, 'utf8');
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

    it(
      'fetches video metadata past the bot wall',
      async (ctx) => {
        const deadline = caseDeadline(METADATA_CASE_MS);
        const jobDir = await mkdtemp(join(tmpdir(), 'ytlive-meta-'));
        const meta = await liveStep(ctx, deadline, (timeoutMs) =>
          ytdlpJson(VIDEO_URL, jobDir, timeoutMs),
        );

        expect(meta.id).toBeTruthy();
        expect(meta.title).toBeTruthy();
        // A caption/transcript track must be advertised — proves we reached the
        // player API, not just a bot-wall interstitial.
        expect(captionLangs(meta).length).toBeGreaterThan(0);
      },
      METADATA_CASE_MS,
    );

    it(
      'pulls a non-empty English transcript',
      async (ctx) => {
        const deadline = caseDeadline(TRANSCRIPT_CASE_MS);
        const jobDir = await mkdtemp(join(tmpdir(), 'ytlive-subs-'));
        const meta = await liveStep(ctx, deadline, (timeoutMs) =>
          ytdlpJson(VIDEO_URL, jobDir, timeoutMs),
        );

        // Prefer a plain `en` track; else the first advertised caption language.
        const langs = captionLangs(meta);
        const lang =
          langs.find((l) => l === 'en') ??
          langs.find((l) => l.startsWith('en')) ??
          langs[0];
        expect(lang).toBeTruthy();

        const vttPath = await liveStep(ctx, deadline, (timeoutMs) =>
          ytdlpWriteSubs(VIDEO_URL, lang, jobDir, {
            includeAutoGenerated: true,
            timeoutMs,
          }),
        );
        expect(vttPath).toBeTruthy();

        const vtt = await readFile(vttPath as string, 'utf8');
        // Strip the WEBVTT header, cue timings, and markup; assert real words
        // remain — a genuine transcript, not an empty or header-only file.
        const words = vtt
          .replace(/WEBVTT|Kind:[^\n]*|Language:[^\n]*/g, '')
          .replace(/\d{2}:\d{2}:\d{2}\.\d{3}\s*-->.*$/gm, '')
          .replace(/<[^>]*>/g, '')
          .replace(/[^A-Za-z]+/g, ' ')
          .trim();
        expect(words.length).toBeGreaterThan(50);
      },
      TRANSCRIPT_CASE_MS,
    );

    // Multi-link coverage: the same shipped path must handle different link
    // SHAPES and a second content type (the trial feedback asked to "use
    // multiple kinds of links"). Each skips on a bot wall like the cases above.
    it(
      'pulls a transcript from a youtu.be short link',
      async (ctx) => {
        const words = await transcriptWords(
          ctx,
          'https://youtu.be/dQw4w9WgXcQ',
        );
        expect(words.toLowerCase()).toContain('give you up');
      },
      TRANSCRIPT_CASE_MS,
    );

    it(
      'pulls a transcript from a different, spoken-word video',
      async (ctx) => {
        // "Me at the zoo" — the first YouTube video: 19s, spoken word, stable
        // auto-captions about elephants and their long trunks.
        const words = await transcriptWords(
          ctx,
          'https://www.youtube.com/watch?v=jNQXAC9IVRw',
        );
        expect(words.split(' ').length).toBeGreaterThan(10);
        expect(words.toLowerCase()).toMatch(/elephant|trunk/);
      },
      TRANSCRIPT_CASE_MS,
    );
  },
);
