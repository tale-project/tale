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

// Flags supported by every yt-dlp release we care about (≥ 2024.04).
const BASE_FLAGS: ReadonlyArray<string> = [
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
  // SSRF subprocess-layer defense. Pre-resolve in `url_safety.ts` walks
  // every A/AAAA record, but yt-dlp's own resolver runs independently
  // when it spawns. Restricting to IPv4 narrows the TOCTOU rebind window.
  '--force-ipv4',
  '--restrict-filenames',
  '--downloader',
  'native',
  '--ffmpeg-location',
  '/usr/bin/ffmpeg',
  '--extractor-args',
  'youtube:player_client=default,tv_simply',
];

// Flags whose support depends on the installed yt-dlp version. Probed
// once via `yt-dlp --help` at first invocation and cached for the
// lifetime of the Node action runtime. Production runs the version
// pinned by services/convex/Dockerfile and always has every flag; this
// machinery is for dev hosts running older system-installed yt-dlp.
//
// Each entry: a probe substring that must appear in `--help` output AND
// the argv tokens to inject when present. The pair is contiguous in argv
// so we can pass them as a unit.
interface OptionalFlag {
  helpToken: string;
  argv: ReadonlyArray<string>;
  /** Used in the version-mismatch warning to point operators at the
   * minimum yt-dlp release that introduced the flag. */
  sinceVersion: string;
}

const OPTIONAL_FLAGS: ReadonlyArray<OptionalFlag> = [
  // Reserved for future version-gated yt-dlp flags. Round-1 review
  // requested a `--max-redirects` cap for SSRF redirect chains, but
  // yt-dlp has never shipped such a flag — HTTP redirect handling is
  // entirely internal. The probe machinery stays in place for when a
  // genuinely version-gated flag lands.
];

/**
 * Lazy probe of `yt-dlp --help`. The result is cached for the lifetime
 * of the Node action instance — every action run after the first reuses
 * the prior probe instead of paying the spawn cost again.
 *
 * Returns the concrete argv that the version on PATH actually accepts.
 */
let supportedFlagsCache: Promise<string[]> | null = null;

function resolveSupportedFlags(): Promise<string[]> {
  if (supportedFlagsCache) return supportedFlagsCache;
  supportedFlagsCache = new Promise<string[]>((resolve) => {
    const child = spawn(YTDLP_BIN, ['--help'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: '/usr/local/bin:/usr/bin:/bin',
        HOME: tmpdir(),
        LANG: 'C.UTF-8',
      },
    });
    let helpText = '';
    child.stdout.on('data', (d) => {
      helpText += d.toString();
    });
    child.stderr.on('data', (d) => {
      // Some versions print --help to stderr; defend against that too.
      helpText += d.toString();
    });
    const finish = () => {
      const extra: string[] = [];
      for (const opt of OPTIONAL_FLAGS) {
        if (helpText.includes(opt.helpToken)) {
          extra.push(...opt.argv);
        } else {
          console.warn(
            `[ytdlp] flag '${opt.helpToken}' not supported by the yt-dlp on PATH; ` +
              `upgrade to ≥ ${opt.sinceVersion} to enable. Falling back without it.`,
          );
        }
      }
      resolve([...BASE_FLAGS, ...extra]);
    };
    child.on('close', finish);
    child.on('error', () => {
      // ENOENT / EPERM / etc. — the real runYtdlp call below will hit
      // the same error and surface `binaryNotInstalled`. Resolve with
      // BASE_FLAGS so we don't block forever; the spawn there carries
      // the right diagnostic to the chip.
      resolve([...BASE_FLAGS]);
    });
  });
  return supportedFlagsCache;
}

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

function sanitizeStderr(raw: string): string {
  let out = raw;
  for (const [re, sub] of SANITIZE_PATTERNS) out = out.replace(re, sub);
  return out.slice(-800); // tail only — full stderr can be MB on chatty errors
}

export type YtDlpErrorReason =
  | 'privateOrAgeGated'
  | 'unavailable'
  | 'geoblocked'
  | 'unsupported'
  | 'transient'
  | 'botDetection'
  | 'rateLimited'
  | 'forbidden'
  | 'liveStream'
  | 'premiere'
  | 'memberOnly'
  | 'jsRuntimeMissing'
  | 'binaryNotInstalled'
  | 'timeout'
  | 'outputValidationFailed';

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
 *  - `botDetection` and `rateLimited` DO NOT go through the
 *    [30s, 60s, 120s] retry — caller should use long jitter or fail
 *    fast. YouTube's per-IP rate limit is minutes; short retries
 *    just trigger harder blocks.
 *  - `jsRuntimeMissing` means the image is misconfigured (no Deno).
 *    Caller should alert loudly, not silently retry.
 */
function classifyYtDlpStderr(stderr: string): YtDlpErrorReason {
  const s = stderr.toLowerCase();
  if (
    s.includes('sign in to confirm') ||
    s.includes("you're not a bot") ||
    s.includes('confirm you’re not a bot')
  ) {
    return 'botDetection';
  }
  if (s.includes('429') || s.includes('too many requests'))
    return 'rateLimited';
  if (
    s.includes('private video') ||
    s.includes('age-restricted') ||
    s.includes('age restricted') ||
    s.includes('sign in to confirm your age')
  ) {
    return 'privateOrAgeGated';
  }
  if (s.includes('members-only') || s.includes('join this channel')) {
    return 'memberOnly';
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
    return 'liveStream';
  }
  if (s.includes('unsupported url')) return 'unsupported';
  if (s.includes('no supported javascript runtime')) return 'jsRuntimeMissing';
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
  // Resolve the flag set the installed yt-dlp actually accepts. First
  // call probes `--help` and caches; subsequent calls are free.
  const commonFlags = await resolveSupportedFlags();
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP_BIN, [...commonFlags, ...args], {
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
    // Settled-flag pattern. Without this, the timeout handler synchronously
    // calls `reject` BEFORE `close` fires; the eventual `close` then calls
    // `reject` a second time (Node silently ignores it) — but more
    // importantly, callers' `.catch` chain proceeds to `fs.readdir` /
    // cleanup while the child is still writing to `jobDir` during the
    // SIGTERM→SIGKILL grace window. Resolve/reject only after `close`.
    let settled = false;
    let timedOut = false;
    let byteCapExceeded = false;
    let sigkillTimer: NodeJS.Timeout | undefined;
    let killer: NodeJS.Timeout | undefined;
    const settleReject = (err: unknown): void => {
      if (settled) return;
      settled = true;
      if (killer) clearTimeout(killer);
      if (sigkillTimer) clearTimeout(sigkillTimer);
      reject(err);
    };
    const settleResolve = (val: YtDlpSpawnResult): void => {
      if (settled) return;
      settled = true;
      if (killer) clearTimeout(killer);
      if (sigkillTimer) clearTimeout(sigkillTimer);
      resolve(val);
    };
    const killEscalate = (): void => {
      try {
        proc.kill('SIGTERM');
      } catch {
        /* already exited */
      }
      sigkillTimer = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          /* already exited */
        }
      }, 5_000);
    };

    proc.stdout.on('data', (d) => {
      stdoutBytes += d.length;
      if (stdoutBytes < MAX_BYTES) stdout += d.toString();
      else if (!byteCapExceeded) {
        // Once the cap is hit, terminate the child — letting it keep
        // streaming wastes CPU/IO and a hostile output (huge JSON dump,
        // chatty stderr retry loop) can hold the action hostage for the
        // full wall-clock budget.
        byteCapExceeded = true;
        killEscalate();
      }
    });
    proc.stderr.on('data', (d) => {
      stderrBytes += d.length;
      if (stderrBytes < MAX_BYTES) stderr += d.toString();
      else if (!byteCapExceeded) {
        byteCapExceeded = true;
        killEscalate();
      }
    });

    // SIGTERM → SIGKILL escalation. Gives yt-dlp + its ffmpeg child a 5s
    // window to flush partial files, close sockets, and exit cleanly
    // before we hard-kill the process group. Without the grace period
    // ffmpeg can be orphaned mid-write and leave .part files behind
    // (R2 review M-yt-dlp).
    killer = setTimeout(() => {
      timedOut = true;
      killEscalate();
      // Reject is deferred to the `close` handler below so streams have
      // a chance to drain — otherwise the caller's `.catch` races
      // jobDir cleanup against still-writing ffmpeg children.
    }, timeoutMs);

    proc.on('error', (err) => {
      // ENOENT means the yt-dlp binary isn't on $PATH — the container
      // was started from an image built before the Dockerfile yt-dlp
      // install landed. Surface as a NEVER_RETRY reason so the chip
      // flips to failed immediately with a clear message, instead of
      // burning 3 retry cycles with opaque "transient" errors.
      const errno = (err as NodeJS.ErrnoException).code;
      if (errno === 'ENOENT') {
        settleReject(
          new YtDlpError(
            'binaryNotInstalled',
            `yt-dlp binary not found at PATH — rebuild the Convex container`,
            '',
          ),
        );
        return;
      }
      settleReject(err);
    });
    proc.on('close', (code) => {
      const sanitized = sanitizeStderr(stderr);
      if (timedOut) {
        settleReject(
          new YtDlpError(
            'timeout',
            `yt-dlp timed out after ${timeoutMs}ms`,
            sanitized,
          ),
        );
        return;
      }
      if (byteCapExceeded) {
        settleReject(
          new YtDlpError(
            'transient',
            `yt-dlp output exceeded ${MAX_BYTES} bytes (cap-killed)`,
            sanitized,
          ),
        );
        return;
      }
      if (code !== 0) {
        const reason = classifyYtDlpStderr(sanitized);
        settleReject(
          new YtDlpError(
            reason,
            `yt-dlp exited ${code} (reason: ${reason})`,
            sanitized,
          ),
        );
        return;
      }
      settleResolve({ stdout, stderr });
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
      'outputValidationFailed',
      `yt-dlp wrote outside sandbox: ${real}`,
      '',
    );
  }
  const ext = real.slice(real.lastIndexOf('.')).toLowerCase();
  if (!SAFE_EXTENSIONS.has(ext)) {
    throw new YtDlpError(
      'outputValidationFailed',
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

function isYtDlpMetadata(value: unknown): value is YtDlpMetadata {
  return typeof value === 'object' && value !== null;
}

export async function ytdlpJson(
  url: string,
  jobDir: string,
  timeoutMs = 90_000,
): Promise<YtDlpMetadata> {
  const { stdout } = await runYtdlp(['-J', '--', url], jobDir, timeoutMs);
  // `-J` produces a single JSON object on stdout. For non-playlist URLs
  // we asked for, it's the video info_dict directly.
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    throw new YtDlpError(
      'transient',
      `yt-dlp produced unparseable metadata JSON`,
      err instanceof Error ? err.message.slice(0, 200) : '',
    );
  }
  if (!isYtDlpMetadata(parsed)) {
    throw new YtDlpError(
      'transient',
      `yt-dlp metadata is not a JSON object`,
      '',
    );
  }
  return parsed;
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
// Lang token shape: BCP-47-ish identifier (`en`, `zh-Hans`, `pt-BR`,
// `en-orig`) plus the `-suffix` variants yt-dlp uses for original / ASR
// tracks. Strict allow-list keeps attacker-controlled metadata keys
// (`Object.keys(meta.subtitles)`) from injecting commas/regex tokens
// into the `--sub-langs` value below — yt-dlp parses that as a comma-
// separated list with regex tokens, so an attacker-supplied key like
// `en,-danmaku,evil-track` could broaden the selection. Defense-in-depth:
// `selectCaptionLanguage` only picks from known yt-dlp metadata, but a
// future code change loosening that step shouldn't open a hole here.
const LANG_TOKEN_RE = /^[A-Za-z0-9_.\-]{1,32}$/;

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
  if (!LANG_TOKEN_RE.test(lang)) {
    throw new YtDlpError(
      'unsupported',
      `Refusing to fetch subs: lang token "${lang.slice(0, 20)}" failed allow-list`,
      '',
    );
  }
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
    // Hard cap on the on-disk subtitle file. yt-dlp will refuse to write
    // a track bigger than this — defends against a hostile uploader
    // hosting a multi-GB JSON3-converted-to-VTT that would OOM both the
    // download step and the in-memory parse step. 5 MB is well past any
    // legitimate transcript (≈ 8h auto-generated VTT at ~1 cue/s).
    '--max-filesize',
    '5M',
    '--paths',
    `home:${jobDir}`,
    '--paths',
    `temp:${jobDir}`,
    '-o',
    '%(id)s.%(ext)s',
    // `--` separator: defense-in-depth against URL-starting-with-dash
    // being reinterpreted as a flag. `assertSafeUrl` already requires
    // `https:` so this is currently unreachable, but loosening URL
    // validation later won't accidentally break this argv shape.
    '--',
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
    // 100M cap pairs with Whisper's ~25MB compressed-input limit (with
    // headroom for raw ogg + ffmpeg overhead). Previous 500M cap let
    // peak RSS exceed 1GB when paired with the in-memory readFile→Blob
    // double-buffer in the orchestrator (R2 review M1).
    '100M',
    '--paths',
    `home:${jobDir}`,
    '--paths',
    `temp:${jobDir}`,
    '-o',
    '%(id)s.%(ext)s',
    // `--` separator: defense-in-depth (see ytdlpWriteSubs comment).
    '--',
    url,
  ];
  await runYtdlp(args, jobDir, timeoutMs);

  const entries = await fs.readdir(jobDir);
  const audio = entries.find((e) => e.endsWith('.ogg'));
  if (!audio) {
    throw new YtDlpError(
      'outputValidationFailed',
      'yt-dlp did not produce expected .ogg output',
      '',
    );
  }
  const full = resolvePath(jobDir, audio);
  await assertOutputUnderSandbox(full, jobDir);
  return full;
}
