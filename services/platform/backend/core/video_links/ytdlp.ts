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
 * Boot-time SHA256-verified install in `services/platform/Dockerfile`.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';

const YTDLP_BIN = 'yt-dlp';

/**
 * Where `services/platform/Dockerfile` bakes the bgutil PO-token-provider yt-dlp
 * plugin, and the compose sidecar (`bgutil-provider`) that serves the tokens.
 * Both are present only in the self-hosted image + stack; when the plugin dir
 * exists we default the plugin path and provider URL so PO tokens work with
 * ZERO operator config (mirrors `knowledge_db.ts`'s `knowledge-db` fallback).
 * `VIDEO_INGEST_YTDLP_PLUGIN_DIRS` / `VIDEO_INGEST_POT_PROVIDER_URL` override.
 * Evaluated once at module load — cheap, and the image layout never changes at
 * runtime. Absent on a host `bun dev` (no baked dir) → defaults stay dormant.
 *
 * Layout under this root MUST be `bgutil/yt_dlp_plugins/…` (not a bare
 * `yt_dlp_plugins/`): yt-dlp `--plugin-dirs` iterates children of this path.
 * See `BGUTIL_PLUGIN_NEST_DIR` in `ytdlp_toolchain.ts` and the Dockerfile.
 */
const BAKED_YTDLP_PLUGIN_DIR = '/opt/yt-dlp/plugins';
const DEFAULT_POT_PROVIDER_URL = 'http://bgutil-provider:4416';
const HAS_BAKED_YTDLP_PLUGIN = existsSync(BAKED_YTDLP_PLUGIN_DIR);

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
  // NOTE: `--ffmpeg-location` used to live here, hard-pinned to
  // `/usr/bin/ffmpeg`. It moved OUT into the per-invocation
  // `ffmpegLocationFlags(env)` so the LIVE ingest test can point yt-dlp at a
  // self-provisioned ffmpeg (e.g. Homebrew's) discovered AFTER this array is
  // module-cached. The production default is byte-for-byte unchanged.
  // NOTE: the `youtube:player_client=…` extractor-arg moved out of BASE_FLAGS
  // into `buildAntiBotFlags` so it can be tuned per deployment (and combined
  // with a PO token / provider) via env without editing this cached set.
];

// ---------------------------------------------------------------------------
// Spawn PATH + ffmpeg location — resolved from `process.env` on EVERY spawn so
// the LIVE ingest test (`ytdlp_live.test.ts`) can inject a self-provisioned
// toolchain (see `ytdlp_toolchain.ts`) AFTER this module is imported + cached.
// Both keep the production defaults byte-for-byte, so an unset environment (the
// baked convex image) behaves exactly as before.
// ---------------------------------------------------------------------------

/**
 * PATH for the yt-dlp/ffmpeg child. Production pins the minimal set the
 * Dockerfile installs into (`/usr/local/bin:/usr/bin:/bin`) — deliberately NOT
 * `process.env.PATH`, so a dev host's shell PATH can't leak arbitrary binaries
 * into the sandboxed child. `VIDEO_INGEST_BIN_DIR`, when set, is PREPENDED so a
 * self-provisioned yt-dlp + deno (downloaded outside the pinned dirs, e.g. into
 * a per-user cache) is found first. Read per-spawn — never baked into a cache —
 * so the live test can set it after module load.
 */
export function buildSpawnPath(env: NodeJS.ProcessEnv): string {
  const base = '/usr/local/bin:/usr/bin:/bin';
  const extra = env.VIDEO_INGEST_BIN_DIR?.trim();
  return extra ? `${extra}:${base}` : base;
}

/**
 * `--ffmpeg-location` for yt-dlp's post-processing (subtitle convert + audio
 * extract). Passed EXPLICITLY rather than resolved via PATH, so it works even
 * when ffmpeg lives outside the pinned spawn PATH — e.g. Homebrew's
 * `/opt/homebrew/bin/ffmpeg` on a dev laptop. Defaults to the Dockerfile's
 * `/usr/bin/ffmpeg`; `VIDEO_INGEST_FFMPEG_LOCATION` overrides with an absolute
 * path. Built per-invocation (NOT in the cached `BASE_FLAGS`) so the live test
 * can point it at a self-provisioned ffmpeg after module load.
 */
export function ffmpegLocationFlags(env: NodeJS.ProcessEnv): string[] {
  return [
    '--ffmpeg-location',
    env.VIDEO_INGEST_FFMPEG_LOCATION?.trim() || '/usr/bin/ffmpeg',
  ];
}

// Flags whose support depends on the installed yt-dlp version. Probed
// once via `yt-dlp --help` at first invocation and cached for the
// lifetime of the Node action runtime. Production runs the version
// pinned by services/platform/Dockerfile and always has every flag; this
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

// ---------------------------------------------------------------------------
// Anti-bot-detection flags (built per invocation from deployment env)
//
// YouTube walls automated access from datacenter/server IPs with a
// "Sign in to confirm you're not a bot" challenge. Nothing here is a
// guaranteed bypass — YouTube's countermeasures are adversarial and change
// weekly — but each option makes traffic look more legitimate. In order of
// leverage: a clean egress IP (residential/ISP proxy) > a PO-token provider >
// guest cookies > client tuning. All are OPT-IN via env so the default build
// is unchanged. Flags are built as ARGV (never child env — the spawn env is
// deliberately stripped of secrets), and every credential-bearing value is
// covered by the stderr sanitizer below.
// ---------------------------------------------------------------------------

/** Proxy schemes yt-dlp understands (`utils/networking.py`). */
const SUPPORTED_PROXY_SCHEMES = new Set([
  'http:',
  'https:',
  'socks4:',
  'socks4a:',
  'socks5:',
  'socks5h:',
]);

/**
 * `--proxy` from `VIDEO_INGEST_PROXY_URL`. The single highest-leverage
 * mitigation: routing extraction through a residential/ISP egress moves it off
 * the deployment's flagged datacenter IP. Prefer `socks5h://` so DNS also
 * resolves at the proxy. Invalid values are logged (redacted) and ignored
 * rather than failing ingestion outright.
 */
export function proxyFlagsFromEnv(env: NodeJS.ProcessEnv): string[] {
  const raw = env.VIDEO_INGEST_PROXY_URL?.trim();
  if (!raw) return [];
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    console.warn('[ytdlp] VIDEO_INGEST_PROXY_URL is not a valid URL; ignoring');
    return [];
  }
  if (!SUPPORTED_PROXY_SCHEMES.has(url.protocol)) {
    console.warn(
      `[ytdlp] VIDEO_INGEST_PROXY_URL scheme "${url.protocol}" is unsupported; ignoring`,
    );
    return [];
  }
  return ['--proxy', raw];
}

/** Default YouTube player clients when no PO-token provider is wired.
 * `default` (= android_vr, web_safari) needs no PO token; `tv_simply` is a
 * lightweight fallback that may skip formats without a GVS token. */
const DEFAULT_YOUTUBE_PLAYER_CLIENT = 'default,tv_simply';

/**
 * When a PO-token provider is available (baked plugin → compose sidecar, or
 * an explicit `VIDEO_INGEST_POT_PROVIDER_URL`), include `mweb` — yt-dlp's
 * PO-Token Guide TL;DR is "provider + mweb for GVS". Without `mweb` in the
 * list the provider is registered but rarely asked, and flagged datacenter
 * IPs still hit the bot wall. Operators can still override via env.
 */
const DEFAULT_YOUTUBE_PLAYER_CLIENT_WITH_POT = 'default,mweb,tv_simply';

/** Values yt-dlp accepts for the `youtube:fetch_pot` extractor-arg. */
const FETCH_POT_VALUES = new Set(['never', 'auto', 'always']);

/**
 * `--extractor-args` for YouTube: the player-client list (env-tunable) plus an
 * optional manually-supplied PO token, and — separately — a PO-token provider
 * base URL (the bgutil HTTP provider). The provider is the sustainable way to
 * supply the GVS tokens that dissolve the bot wall for `mweb`/`web`/`tv_simply`
 * on a flagged IP; a manually-pinned token is video-ID-bound and short-lived,
 * so it's mainly for testing. Harmless for non-YouTube extractors (yt-dlp
 * ignores extractor-args that don't match the active extractor).
 */
/**
 * A pre-warmed session drawn from the pool for a single yt-dlp invocation: a
 * cookie jar already written to the job dir, plus optional YouTube visitor data
 * / PO token. Preferred over the env-configured equivalents when present.
 */
export interface YtdlpSession {
  cookiesFile?: string;
  visitorData?: string;
  poToken?: string;
}

export function youtubeExtractorArgsFromEnv(
  env: NodeJS.ProcessEnv,
  session?: YtdlpSession,
  hasBakedPlugin: boolean = HAS_BAKED_YTDLP_PLUGIN,
): string[] {
  // Explicit env wins; otherwise, when the bgutil plugin is baked into the
  // image, default to the compose sidecar so PO tokens work out of the box.
  const providerUrl =
    env.VIDEO_INGEST_POT_PROVIDER_URL?.trim() ||
    (hasBakedPlugin ? DEFAULT_POT_PROVIDER_URL : undefined);

  const client =
    env.VIDEO_INGEST_PLAYER_CLIENT?.trim() ||
    (providerUrl
      ? DEFAULT_YOUTUBE_PLAYER_CLIENT_WITH_POT
      : DEFAULT_YOUTUBE_PLAYER_CLIENT);
  const parts = [`player_client=${client}`];
  const poToken = session?.poToken?.trim() || env.VIDEO_INGEST_PO_TOKEN?.trim();
  if (poToken) parts.push(`po_token=${poToken}`);
  const visitorData = session?.visitorData?.trim();
  if (visitorData) parts.push(`visitor_data=${visitorData}`);

  // Under yt-dlp's default `fetch_pot=auto`, a PLAYER-context PO token is only
  // requested when the client's policy marks it required/recommended — which
  // no WEBPO client does. The bot wall hits exactly that player request, so a
  // healthy provider ends up registered but never consulted (verified live on
  // a flagged datacenter IP: zero provider calls until this arg is set).
  // With a local sidecar the extra fetch is one cheap HTTP call per client →
  // default to `always` whenever a provider is wired. `VIDEO_INGEST_FETCH_POT`
  // (never|auto|always) overrides; `never` is the escape hatch if a wedged
  // provider ever stalls player requests.
  const fetchPotRaw = env.VIDEO_INGEST_FETCH_POT?.trim();
  let fetchPot = providerUrl ? 'always' : undefined;
  if (fetchPotRaw) {
    if (FETCH_POT_VALUES.has(fetchPotRaw)) {
      fetchPot = fetchPotRaw;
    } else {
      console.warn(
        `[ytdlp] VIDEO_INGEST_FETCH_POT "${fetchPotRaw}" is not one of never|auto|always; ignoring`,
      );
    }
  }
  if (fetchPot) parts.push(`fetch_pot=${fetchPot}`);
  const flags = ['--extractor-args', `youtube:${parts.join(';')}`];

  if (providerUrl) {
    if (URL.canParse(providerUrl)) {
      flags.push(
        '--extractor-args',
        `youtubepot-bgutilhttp:base_url=${providerUrl}`,
      );
    } else {
      console.warn(
        '[ytdlp] VIDEO_INGEST_POT_PROVIDER_URL is not a valid URL; ignoring',
      );
    }
  }
  return flags;
}

/**
 * `--cookies <file>` from `VIDEO_INGEST_COOKIES_FILE`. A Netscape cookie jar
 * captured from an anonymous incognito session raises the guest rate limit and
 * softens the bot wall with no account-ban risk; an authenticated jar unlocks
 * gated content but risks the account (operator's call). The path itself isn't
 * secret; the jar file lives on the operator's disk and is never read here.
 */
export function cookiesFlagsFromEnv(
  env: NodeJS.ProcessEnv,
  session?: YtdlpSession,
): string[] {
  // A pooled session's freshly-written jar takes precedence over the static
  // env-configured path.
  const path =
    session?.cookiesFile?.trim() || env.VIDEO_INGEST_COOKIES_FILE?.trim();
  return path ? ['--cookies', path] : [];
}

/**
 * `--plugin-dirs <dir>` from `VIDEO_INGEST_YTDLP_PLUGIN_DIRS`. Points yt-dlp at
 * a plugins directory (e.g. where the bgutil PO-token-provider plugin is baked
 * into the image) — needed because the spawn sets `HOME` to the throwaway job
 * dir, so the default `~/.config/yt-dlp/plugins` never resolves. Falls back to
 * the baked plugin dir when it exists, so the self-hosted image needs no config.
 */
export function pluginDirFlagsFromEnv(
  env: NodeJS.ProcessEnv,
  hasBakedPlugin: boolean = HAS_BAKED_YTDLP_PLUGIN,
): string[] {
  const dir =
    env.VIDEO_INGEST_YTDLP_PLUGIN_DIRS?.trim() ||
    (hasBakedPlugin ? BAKED_YTDLP_PLUGIN_DIR : undefined);
  return dir ? ['--plugin-dirs', dir] : [];
}

/**
 * `--impersonate <target>` (e.g. `safari`) from `VIDEO_INGEST_IMPERSONATE`.
 * Matches the TLS/JA3 fingerprint to a real browser for the web clients.
 * Requires `curl_cffi` in the image, so it stays opt-in — an unset default can
 * never break a build that lacks it.
 */
export function impersonateFlagsFromEnv(env: NodeJS.ProcessEnv): string[] {
  const target = env.VIDEO_INGEST_IMPERSONATE?.trim();
  return target ? ['--impersonate', target] : [];
}

/** Always-on light request pacing — keeps the per-IP request rate under
 * YouTube's guest ceiling without meaningfully slowing a single video. */
const STEALTH_FLAGS: ReadonlyArray<string> = ['--sleep-requests', '1'];

/**
 * Assemble every anti-bot flag from the environment. Order is irrelevant to
 * yt-dlp; grouped by concern for readability.
 */
export function buildAntiBotFlags(
  env: NodeJS.ProcessEnv,
  session?: YtdlpSession,
): string[] {
  return [
    ...proxyFlagsFromEnv(env),
    ...pluginDirFlagsFromEnv(env),
    ...cookiesFlagsFromEnv(env, session),
    ...impersonateFlagsFromEnv(env),
    ...youtubeExtractorArgsFromEnv(env, session),
    ...STEALTH_FLAGS,
  ];
}

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
        // Prepends `VIDEO_INGEST_BIN_DIR` when set (see `buildSpawnPath`) so
        // the probe hits the same yt-dlp the live test self-provisioned.
        PATH: buildSpawnPath(process.env),
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
type Replacement = string | ((match: string) => string);
const SANITIZE_PATTERNS: ReadonlyArray<readonly [RegExp, Replacement]> = [
  [/https?:\/\/[^\s]+/g, 'https://<redacted>'],
  [/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer <redacted>'],
  [/--username\s+\S+/gi, '--username <redacted>'],
  [/--password\s+\S+/gi, '--password <redacted>'],
  [/--cookies(-from-browser)?\s+\S+/gi, '--cookies <redacted>'],
  [/--proxy\s+\S+/gi, '--proxy <redacted>'],
  // Inline credentials in ANY scheme URL (socks included), e.g. a bare
  // `socks5h://user:pass@host:1080` echoed in a connection error without the
  // `--proxy` prefix (the `https?://` rule above only covers http/https).
  // Preserve scheme+host, drop `user:pass@`.
  [
    /\b([a-z][a-z0-9+.-]*:\/\/)[^\s:@/]+:[^\s@/]+@/gi,
    (m: string): string => `${m.slice(0, m.indexOf('//') + 2)}<redacted>@`,
  ],
  [/Authorization:\s*\S+/gi, 'Authorization: <redacted>'],
  // Cookie / Set-Cookie headers: yt-dlp -v dumps full cookie jars on
  // some failure paths. Strip the whole header value, not just the
  // first attribute pair.
  [/(?:Set-)?Cookie:\s*[^\r\n]+/gi, 'Cookie: <redacted>'],
  // S3-style presigned URL params; yt-dlp may print these stripped from
  // their parent URL when reporting "Got HTTP Error" lines.
  [/Signature=[^&\s]+/g, 'Signature=<redacted>'],
  [/Policy=[^&\s]+/g, 'Policy=<redacted>'],
  // YouTube + general OAuth/session token params that can appear bare
  // in error messages (no `https://` prefix to match URL pattern).
  // Preserve the key name so operators can identify the leak; redact
  // only the value.
  [
    /\b(po_token|visitor_data|cpn|pot|sig|signature|access_token|id_token|refresh_token|SAPISIDHASH|SAPISID)=[^\s&]+/gi,
    (m: string): string => `${m.split('=')[0]}=<redacted>`,
  ],
  // Standalone JWTs (header.payload.signature, three base64url segments).
  [
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    '<redacted-jwt>',
  ],
];

export function sanitizeStderr(raw: string): string {
  let out = raw;
  for (const [re, sub] of SANITIZE_PATTERNS) {
    // String.replace's overload signature accepts either a string or a
    // function; the union widening matters for the typechecker only.
    out =
      typeof sub === 'function' ? out.replace(re, sub) : out.replace(re, sub);
  }
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
export function classifyYtDlpStderr(stderr: string): YtDlpErrorReason {
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
    // Matched loosely ("available in your …", not "not available in your …")
    // because yt-dlp phrasings vary: e.g. "The uploader has not made this
    // video available in your country" separates "not" from "available".
    s.includes('available in your country') ||
    s.includes('available in your region') ||
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
  session?: YtdlpSession,
): Promise<YtDlpSpawnResult> {
  // Resolve the flag set the installed yt-dlp actually accepts. First
  // call probes `--help` and caches; subsequent calls are free.
  const commonFlags = await resolveSupportedFlags();
  // Anti-bot flags are rebuilt per call (cheap) so an operator can change
  // proxy / provider / cookies config without restarting — env is re-read
  // from `process.env`, which the deployment env-sync keeps current. A pooled
  // session (if provided) supplies its own cookie jar + visitor data.
  const antiBotFlags = buildAntiBotFlags(process.env, session);
  return new Promise((resolve, reject) => {
    // `detached: true` puts the child in its own process group so we can
    // signal the whole group with `process.kill(-pid, ...)` on timeout.
    // Without this, yt-dlp's ffmpeg grandchild orphans when the Convex
    // action is hard-killed — the wrapper Node process terminates but
    // ffmpeg continues to its natural exit, leaving disk/CPU usage that
    // the entrypoint's 60-min tmpdir sweep can only partially reclaim.
    // `ffmpegLocationFlags` is merged in per-invocation (read from
    // `process.env`, NOT the cached `commonFlags`) so the live test's
    // self-provisioned ffmpeg path takes effect after module load.
    const proc = spawn(
      YTDLP_BIN,
      [
        ...commonFlags,
        ...ffmpegLocationFlags(process.env),
        ...antiBotFlags,
        ...args,
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: jobDir,
        detached: true,
        // env stripped to the minimum yt-dlp + ffmpeg need. NEVER pass
        // process.env — Convex secrets (SOPS_AGE_KEY, db creds, provider
        // tokens) would land in the child's environment. `buildSpawnPath`
        // keeps the pinned production PATH unless `VIDEO_INGEST_BIN_DIR` is set.
        env: {
          PATH: buildSpawnPath(process.env),
          HOME: jobDir,
          LANG: 'C.UTF-8',
        },
      },
    );
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
    // Group-targeted kill: `-pid` (negative, leading-minus) signals the
    // whole process group. yt-dlp spawns ffmpeg as a child; without the
    // group target, our `proc.kill` reaches yt-dlp only and ffmpeg
    // continues converting until natural exit. The fall-back `proc.kill`
    // handles edge cases where setpgid hasn't run yet (very early
    // failures) — same signal, narrower target.
    const killGroup = (signal: NodeJS.Signals): void => {
      const pid = proc.pid;
      if (pid === undefined) return;
      try {
        process.kill(-pid, signal);
      } catch {
        try {
          proc.kill(signal);
        } catch (err) {
          // ESRCH is the child already gone; anything else (EPERM) means
          // the signal never landed and an ffmpeg may be orphaned.
          const code =
            err instanceof Error && 'code' in err ? err.code : undefined;
          if (code !== 'ESRCH') {
            console.warn(
              `[ytdlp] ${signal} fallback failed for pid ${pid}:`,
              err instanceof Error ? err.message : String(err),
            );
          }
        }
      }
    };
    const killEscalate = (): void => {
      killGroup('SIGTERM');
      sigkillTimer = setTimeout(() => killGroup('SIGKILL'), 5_000);
    };

    // SIGTERM → SIGKILL escalation. Gives yt-dlp + its ffmpeg child a 5s
    // window to flush partial files, close sockets, and exit cleanly
    // before we hard-kill the process group. Without the grace period
    // ffmpeg can be orphaned mid-write and leave .part files behind
    // (R2 review M-yt-dlp). Reject is deferred to the `close` handler
    // below so streams have a chance to drain — otherwise the caller's
    // `.catch` races jobDir cleanup against still-writing ffmpeg
    // children.
    const killer = setTimeout(() => {
      timedOut = true;
      killEscalate();
    }, timeoutMs);

    const settleReject = (err: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(killer);
      if (sigkillTimer) clearTimeout(sigkillTimer);
      reject(err);
    };
    const settleResolve = (val: YtDlpSpawnResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(killer);
      if (sigkillTimer) clearTimeout(sigkillTimer);
      resolve(val);
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

    proc.on('error', (err) => {
      // ENOENT means the yt-dlp binary isn't on $PATH — the container
      // was started from an image built before the Dockerfile yt-dlp
      // install landed. Surface as a NEVER_RETRY reason so the chip
      // flips to failed immediately with a clear message, instead of
      // burning 3 retry cycles with opaque "transient" errors.
      // Third-party-gap cast: Node's `'error'` event typings declare
      // `Error` but the runtime always populates `.code` for spawn
      // failures — `NodeJS.ErrnoException` is the lib.d.ts shape.
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
 * `services/platform/docker-entrypoint.sh`.
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
  session?: YtdlpSession,
): Promise<YtDlpMetadata> {
  const { stdout } = await runYtdlp(
    ['-J', '--', url],
    jobDir,
    timeoutMs,
    session,
  );
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
const LANG_TOKEN_RE = /^[A-Za-z0-9_.-]{1,32}$/;

export async function ytdlpWriteSubs(
  url: string,
  lang: string,
  jobDir: string,
  opts: {
    /** If true, include `--write-auto-subs` for ASR auto-generated tracks
     * (used when no manual track in the desired language exists). */
    includeAutoGenerated?: boolean;
    timeoutMs?: number;
    session?: YtdlpSession;
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
    // Prefer native VTT: YouTube (and Vimeo/Dailymotion) serve it directly, so
    // `--convert-subs vtt` is a no-op and no ffmpeg conversion runs. json3 is
    // deliberately EXCLUDED — yt-dlp converts it to VTT via ffmpeg, which cannot
    // read json3 and fails with "Invalid data found when processing input",
    // dropping the whole transcript. srv3/ttml remain as ffmpeg-convertible
    // fallbacks for the rare source without a native VTT track.
    'vtt/srv3/ttml/best',
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
  await runYtdlp(args, jobDir, opts.timeoutMs ?? 90_000, opts.session);

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
 * Download + extract audio to an `.mp3` file.
 *
 * Phase C of the orchestrator — wall-clock 15min covers most 4h videos
 * on a reasonable network.
 *
 * mp3 (libmp3lame) — NOT `vorbis` (libvorbis) — because libvorbis is absent
 * from common ffmpeg builds (notably Homebrew's `ffmpeg` formula ships
 * `--enable-libmp3lame`/`--enable-libopus` but NOT `--enable-libvorbis`), so
 * `--audio-format vorbis` failed the whole ingest with "Encoder not found" on
 * every macOS dev/self-host box. libmp3lame is present in Homebrew AND Debian
 * ffmpeg. The exact intermediate codec barely matters: `audio_preprocess.ts`
 * re-encodes this file to 32 kbps Opus-in-OGG (libopus) before Whisper, so this
 * only has to be a compressed file ffmpeg can read back. We avoid a raw
 * `.opus`/`--audio-format opus` output because that path is what the re-encode
 * later standardizes anyway; a fixed, universally-decodable `.mp3` keeps the
 * extension deterministic for the store + the tmp round-trip.
 */
export async function ytdlpExtractAudio(
  url: string,
  jobDir: string,
  timeoutMs = 15 * 60_000,
  session?: YtdlpSession,
): Promise<string> {
  const args = [
    '-x',
    '--audio-format',
    'mp3',
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
  await runYtdlp(args, jobDir, timeoutMs, session);

  const entries = await fs.readdir(jobDir);
  const audio = entries.find((e) => e.endsWith('.mp3'));
  if (!audio) {
    throw new YtDlpError(
      'outputValidationFailed',
      'yt-dlp did not produce expected .mp3 output',
      '',
    );
  }
  const full = resolvePath(jobDir, audio);
  await assertOutputUnderSandbox(full, jobDir);
  return full;
}
