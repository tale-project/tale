'use node';

/**
 * yt-dlp subprocess wrapper for the video-link ingest pipeline.
 *
 * Mirrors `audio_preprocess.ts:runFfmpeg` shape: array-form `spawn` (no
 * shell), per-call wall-clock timeout with `SIGKILL`, structured error
 * surfaces with sanitized stderr.
 *
 * Hardening (from C4 sub-agent audit + 2024-25 yt-dlp CVE class):
 *   - `--no-config --no-call-home --no-exec --no-update --ignore-config`:
 *     neutralize CVE-2024-22423 `--exec` injection and config-file
 *     hijacks.
 *   - `--restrict-filenames`: yt-dlp's own filename sanitizer (mitigates
 *     CVE-2024-38519 path-traversal class).
 *   - `--paths home:<jobDir> --paths temp:<jobDir>`: every yt-dlp file
 *     write stays inside the per-job sandbox. Output template `%(id)s.%(ext)s`
 *     is fixed by us, never derived from metadata (template injection).
 *   - `--downloader native`: avoid yt-dlp falling through to ffmpeg-as-
 *     downloader (CVE-2023-35934 cookie leak class) or aria2.
 *   - `env` stripped to `{ PATH, HOME: jobDir, LANG: 'C.UTF-8' }` only —
 *     no Convex secrets, no LD_*, no NODE_*.
 *   - Output file validation post-spawn: `fs.realpath` + extension
 *     whitelist; reject anything outside the sandbox.
 *
 * Boot-time SHA256-verified install in `services/convex/Dockerfile`.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';

const YTDLP_BIN = 'yt-dlp';

const COMMON_FLAGS: ReadonlyArray<string> = [
  '--no-config',
  // NOTE: `--no-call-home` was removed in yt-dlp 2025.xx (deprecated since
  // 2024) — emitting it spams stderr and the deprecation message can land
  // in the JSON output stream, breaking `-J` parsers downstream. Leaving
  // it out: `--no-config` + `--ignore-config` already neutralize any
  // call-home behavior configured via user config.
  '--no-exec',
  '--no-update',
  '--ignore-config',
  '--no-playlist',
  '--no-warnings',
  '--no-progress',
  '--no-mtime',
  '--socket-timeout',
  '30',
  '--restrict-filenames',
  '--downloader',
  'native',
  '--ffmpeg-location',
  '/usr/bin/ffmpeg',
  '--extractor-args',
  'youtube:player_client=default,tv_simply',
];

/** Sanitization regex set — strip credentials + URLs + auth headers from
 * stderr before logging. yt-dlp's stderr can echo back signed URLs, cookies,
 * and proxy credentials in some failure modes. */
const SANITIZE_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/https?:\/\/[^\s]+/g, 'https://<redacted>'],
  [/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer <redacted>'],
  [/--username\s+\S+/gi, '--username <redacted>'],
  [/--password\s+\S+/gi, '--password <redacted>'],
  [/--cookies(-from-browser)?\s+\S+/gi, '--cookies <redacted>'],
  [/Authorization:\s*\S+/gi, 'Authorization: <redacted>'],
  [/Signature=[^&\s]+/g, 'Signature=<redacted>'],
  [/Policy=[^&\s]+/g, 'Policy=<redacted>'],
];

export function sanitizeStderr(raw: string): string {
  let out = raw;
  for (const [re, sub] of SANITIZE_PATTERNS) out = out.replace(re, sub);
  return out.slice(-800); // tail only — full stderr can be MB on chatty errors
}

export type YtDlpErrorReason =
  | 'private_or_age_gated'
  | 'unavailable'
  | 'geoblocked'
  | 'unsupported'
  | 'transient'
  | 'bot_detection'
  | 'rate_limited'
  | 'forbidden'
  | 'live_stream'
  | 'premiere'
  | 'member_only'
  | 'js_runtime_missing'
  | 'binary_not_installed'
  | 'timeout'
  | 'output_validation_failed';

export class YtDlpError extends Error {
  readonly reason: YtDlpErrorReason;
  /** Sanitized stderr tail — safe to surface in logs/DB. */
  readonly sanitizedStderr: string;

  constructor(
    reason: YtDlpErrorReason,
    message: string,
    sanitizedStderr: string,
  ) {
    super(message);
    this.name = 'YtDlpError';
    this.reason = reason;
    this.sanitizedStderr = sanitizedStderr;
  }
}

/**
 * Classify a sanitized stderr string into a structured reason code.
 * Patterns are ordered most-specific first; the first match wins.
 *
 * Boundary cases:
 *  - `bot_detection` and `rate_limited` DO NOT go through the
 *    [30s, 60s, 120s] retry — caller should use long jitter or fail
 *    fast. YouTube's per-IP rate limit is minutes; short retries
 *    just trigger harder blocks.
 *  - `js_runtime_missing` means the image is misconfigured (no Deno).
 *    Caller should alert loudly, not silently retry.
 */
export function classifyYtDlpStderr(stderr: string): YtDlpErrorReason {
  const s = stderr.toLowerCase();
  if (
    s.includes('sign in to confirm') ||
    s.includes("you're not a bot") ||
    s.includes('confirm you’re not a bot')
  ) {
    return 'bot_detection';
  }
  if (s.includes('429') || s.includes('too many requests'))
    return 'rate_limited';
  if (
    s.includes('private video') ||
    s.includes('age-restricted') ||
    s.includes('age restricted') ||
    s.includes('sign in to confirm your age')
  ) {
    return 'private_or_age_gated';
  }
  if (s.includes('members-only') || s.includes('join this channel')) {
    return 'member_only';
  }
  if (
    s.includes('not available in your country') ||
    s.includes('not available in your region') ||
    s.includes('geo')
  ) {
    return 'geoblocked';
  }
  if (
    s.includes('this live event will begin') ||
    s.includes('is_upcoming') ||
    s.includes('premieres')
  ) {
    return 'premiere';
  }
  if (s.includes('is a live event') || s.includes('is currently live')) {
    return 'live_stream';
  }
  if (s.includes('unsupported url')) return 'unsupported';
  if (s.includes('no supported javascript runtime'))
    return 'js_runtime_missing';
  if (s.includes('http error 403') || s.includes('forbidden'))
    return 'forbidden';
  if (s.includes('video unavailable') || s.includes('has been removed')) {
    return 'unavailable';
  }
  return 'transient';
}

interface YtDlpSpawnResult {
  stdout: string;
  stderr: string;
}

async function runYtdlp(
  args: string[],
  jobDir: string,
  timeoutMs: number,
): Promise<YtDlpSpawnResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP_BIN, [...COMMON_FLAGS, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: jobDir,
      // env stripped to the minimum yt-dlp + ffmpeg need. NEVER pass
      // process.env — Convex secrets (SOPS_AGE_KEY, db creds, provider
      // tokens) would land in the child's environment.
      env: {
        PATH: '/usr/local/bin:/usr/bin:/bin',
        HOME: jobDir,
        LANG: 'C.UTF-8',
      },
    });
    let stdout = '';
    let stderr = '';
    // Cap accumulated output to prevent OOM on chatty errors. yt-dlp
    // normally produces <100KB of stdout (metadata JSON or single line);
    // stderr can balloon on retries.
    const MAX_BYTES = 8 * 1024 * 1024;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    proc.stdout.on('data', (d) => {
      stdoutBytes += d.length;
      if (stdoutBytes < MAX_BYTES) stdout += d.toString();
    });
    proc.stderr.on('data', (d) => {
      stderrBytes += d.length;
      if (stderrBytes < MAX_BYTES) stderr += d.toString();
    });

    const killer = setTimeout(() => {
      proc.kill('SIGKILL');
      const sanitized = sanitizeStderr(stderr);
      reject(
        new YtDlpError(
          'timeout',
          `yt-dlp timed out after ${timeoutMs}ms`,
          sanitized,
        ),
      );
    }, timeoutMs);

    proc.on('error', (err) => {
      clearTimeout(killer);
      // ENOENT means the yt-dlp binary isn't on $PATH — the container
      // was started from an image built before the Dockerfile yt-dlp
      // install landed. Surface as a NEVER_RETRY reason so the chip
      // flips to failed immediately with a clear message, instead of
      // burning 3 retry cycles with opaque "transient" errors.
      const errno = (err as NodeJS.ErrnoException).code;
      if (errno === 'ENOENT') {
        reject(
          new YtDlpError(
            'binary_not_installed',
            `yt-dlp binary not found at PATH — rebuild the Convex container`,
            '',
          ),
        );
        return;
      }
      reject(err);
    });
    proc.on('close', (code) => {
      clearTimeout(killer);
      if (code !== 0) {
        const sanitized = sanitizeStderr(stderr);
        const reason = classifyYtDlpStderr(sanitized);
        reject(
          new YtDlpError(
            reason,
            `yt-dlp exited ${code} (reason: ${reason})`,
            sanitized,
          ),
        );
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/**
 * Create a per-job tmp sandbox dir. Caller is responsible for cleaning
 * it up via the returned `cleanup` function in a `finally` block.
 *
 * Dir name prefix `vlink-` matches the orphan-sweep regex in
 * `services/convex/docker-entrypoint.sh`.
 */
export async function createJobDir(): Promise<{
  jobDir: string;
  cleanup: () => Promise<void>;
}> {
  const jobDir = join(tmpdir(), `vlink-${randomUUID()}`);
  await fs.mkdir(jobDir, { recursive: true, mode: 0o700 });
  return {
    jobDir,
    cleanup: async () => {
      try {
        await fs.rm(jobDir, { recursive: true, force: true });
      } catch (err) {
        // Non-fatal: dir may have been swept already. Log for forensics.
        console.warn(
          `[video_links/ytdlp] failed to cleanup ${jobDir}:`,
          err instanceof Error ? err.message : err,
        );
      }
    },
  };
}

const SAFE_EXTENSIONS = new Set([
  '.ogg',
  '.opus',
  '.m4a',
  '.mp3',
  '.vtt',
  '.json',
  '.json3',
  '.srt',
]);

/**
 * Validate that a yt-dlp output file lives inside the sandbox and has a
 * whitelisted extension. Mitigates CVE-2024-38519 path-traversal residual:
 * even if yt-dlp's filename sanitizer is bypassed by a future bug, we
 * refuse to consume anything that escaped.
 */
async function assertOutputUnderSandbox(
  filePath: string,
  jobDir: string,
): Promise<void> {
  const realJobDir = await fs.realpath(jobDir);
  const real = await fs.realpath(filePath);
  if (!real.startsWith(realJobDir + '/') && real !== realJobDir) {
    throw new YtDlpError(
      'output_validation_failed',
      `yt-dlp wrote outside sandbox: ${real}`,
      '',
    );
  }
  const ext = real.slice(real.lastIndexOf('.')).toLowerCase();
  if (!SAFE_EXTENSIONS.has(ext)) {
    throw new YtDlpError(
      'output_validation_failed',
      `Unexpected output extension: ${ext}`,
      '',
    );
  }
}

/**
 * yt-dlp metadata fetch. Returns parsed JSON `info_dict`. No download.
 *
 * Phase A of the orchestrator — typical wall-clock <2s; 90s timeout is
 * a generous ceiling.
 */
export interface YtDlpMetadata {
  id?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  duration?: number;
  language?: string;
  is_live?: boolean;
  live_status?: string;
  availability?: string;
  thumbnail?: string;
  chapters?: Array<{ start_time: number; end_time: number; title: string }>;
  subtitles?: Record<
    string,
    Array<{ ext?: string; url?: string; name?: string }>
  >;
  automatic_captions?: Record<
    string,
    Array<{ ext?: string; url?: string; name?: string; protocol?: string }>
  >;
}

export async function ytdlpJson(
  url: string,
  jobDir: string,
  timeoutMs = 90_000,
): Promise<YtDlpMetadata> {
  const { stdout } = await runYtdlp(['-J', url], jobDir, timeoutMs);
  // `-J` produces a single JSON object on stdout. For non-playlist URLs
  // we asked for, it's the video info_dict directly.
  try {
    return JSON.parse(stdout) as YtDlpMetadata;
  } catch (err) {
    throw new YtDlpError(
      'transient',
      `yt-dlp produced unparseable metadata JSON`,
      err instanceof Error ? err.message.slice(0, 200) : '',
    );
  }
}

/**
 * Fetch subtitles in VTT form (yt-dlp converts via ffmpeg from whatever
 * the platform serves — JSON3, SRV3, TTML, native VTT, etc.). Returns
 * the path to the .vtt file under `jobDir`, or null if no subtitle
 * track was produced.
 *
 * Phase B of the orchestrator. `lang` should be a yt-dlp lang spec
 * (e.g. `en`, `en.*`, `zh-Hans`, or `en-orig` for the source-language
 * track when present).
 */
export async function ytdlpWriteSubs(
  url: string,
  lang: string,
  jobDir: string,
  opts: {
    /** If true, include `--write-auto-subs` for ASR auto-generated tracks
     * (used when no manual track in the desired language exists). */
    includeAutoGenerated?: boolean;
    timeoutMs?: number;
  } = {},
): Promise<string | null> {
  const args = [
    '--write-subs',
    ...(opts.includeAutoGenerated ? ['--write-auto-subs'] : []),
    '--sub-format',
    'json3/srv3/ttml/vtt/best',
    '--convert-subs',
    'vtt',
    '--sub-langs',
    // Exclude Bilibili-style noise + AI-translated tracks unless explicitly
    // asked for the auto-gen fallback.
    `${lang},-danmaku${opts.includeAutoGenerated ? '' : ',-ai-.*'}`,
    '--skip-download',
    '--paths',
    `home:${jobDir}`,
    '--paths',
    `temp:${jobDir}`,
    '-o',
    '%(id)s.%(ext)s',
    url,
  ];
  await runYtdlp(args, jobDir, opts.timeoutMs ?? 90_000);

  // Find the .vtt file yt-dlp wrote. It uses the video id + lang code
  // suffix, e.g. `<id>.en.vtt`.
  const entries = await fs.readdir(jobDir);
  const vtt = entries.find((e) => e.endsWith('.vtt'));
  if (!vtt) return null;
  const full = resolvePath(jobDir, vtt);
  await assertOutputUnderSandbox(full, jobDir);
  return full;
}

/**
 * Download + extract audio to an opus-in-ogg `.ogg` file (Whisper-
 * accepted; matches `audio_preprocess.ts:113-119` convention).
 *
 * Phase C of the orchestrator — wall-clock 15min covers most 4h videos
 * on a reasonable network.
 *
 * yt-dlp's `vorbis` post-processor produces opus-in-ogg with `.ogg`
 * extension. We DO NOT pass `--audio-format opus` because that produces
 * a raw `.opus` file which OpenAI's Whisper API rejects (the codec is
 * fine, the extension/MIME is not).
 */
export async function ytdlpExtractAudio(
  url: string,
  jobDir: string,
  timeoutMs = 15 * 60_000,
): Promise<string> {
  const args = [
    '-x',
    '--audio-format',
    'vorbis',
    '--audio-quality',
    '0',
    '--max-filesize',
    '500M', // hard cap; bigger files get rejected with stderr classifier
    '--paths',
    `home:${jobDir}`,
    '--paths',
    `temp:${jobDir}`,
    '-o',
    '%(id)s.%(ext)s',
    url,
  ];
  await runYtdlp(args, jobDir, timeoutMs);

  const entries = await fs.readdir(jobDir);
  const audio = entries.find((e) => e.endsWith('.ogg'));
  if (!audio) {
    throw new YtDlpError(
      'output_validation_failed',
      'yt-dlp did not produce expected .ogg output',
      '',
    );
  }
  const full = resolvePath(jobDir, audio);
  await assertOutputUnderSandbox(full, jobDir);
  return full;
}
