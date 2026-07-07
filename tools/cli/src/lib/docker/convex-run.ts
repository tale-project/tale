/**
 * Shared "run a deployed Convex function with the admin key" channel.
 *
 * The platform container holds the convex CLI plus the env (`INSTANCE_NAME` /
 * `INSTANCE_SECRET`) needed to derive the admin key, and reaches the convex
 * backend over the internal network at `http://convex:3210`. So every CLI →
 * Convex control call (`--override-all` reseed, deploy drain) runs the same
 * incantation: `docker exec -i <platform> bash -s` piping a script that sources
 * `env.sh`, derives `ADMIN_KEY`, then runs `bunx convex run <fn>`.
 *
 * `--no-push` invokes the ALREADY-DEPLOYED function rather than pushing the
 * container's bundled code first (faster, and correct here — the function we
 * call is whatever the running backend has). A function that doesn't exist on
 * the running backend (e.g. an older version that predates it) makes
 * `bunx convex run` exit non-zero; callers decide whether that's fatal.
 */

import { exec, type ExecResult } from './exec';
import { findPlatformContainer } from './find-platform-container';

const DEFAULT_TIMEOUT_S = 120;

/**
 * `grep -v` patterns for stripping `bunx convex run` decorative banners from
 * captured stdout. **Must anchor** `Open`/`Enter`/`Paste`/`Steps:` to line
 * start — unanchored they match migration JSON (e.g. "Enterprise", "OpenRouter")
 * and corrupt the payload before JSON.parse.
 */
export const CONVEX_RUN_BANNER_GREP_V =
  '^Admin key\\|^📋\\|^✅ Admin\\|^━\\|^🌐\\|^$\\|^Steps:\\|^Open\\|^Enter\\|^Paste';

const BANNER_LINE_RE =
  /^(?:Admin key|📋|✅ Admin|━|🌐|Steps:|Open|Enter|Paste)|^$/;

/** Strip known `bunx convex run` banner lines (mirrors {@link CONVEX_RUN_BANNER_GREP_V}). */
export function stripConvexBannerLines(stdout: string): string {
  return stdout
    .split('\n')
    .filter((line) => !BANNER_LINE_RE.test(line))
    .join('\n');
}

/**
 * Parse JSON returned by `bunx convex run` from mixed stdout. Strips banners
 * first, then tries the full string and slices from the first `[` or `{`.
 */
export function parseConvexRunJson<T>(stdout: string): T | null {
  const trimmed = stripConvexBannerLines(stdout).trim();
  if (!trimmed) return null;

  const attempts: string[] = [trimmed];
  const startArr = trimmed.indexOf('[');
  const startObj = trimmed.indexOf('{');
  for (const start of [startArr, startObj]
    .filter((i) => i >= 0)
    .sort((a, b) => a - b)) {
    const slice = trimmed.slice(start);
    if (!attempts.includes(slice)) attempts.push(slice);
  }

  for (const candidate of attempts) {
    try {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- caller declares contract
      return JSON.parse(candidate) as T;
    } catch {
      // try next slice
    }
  }
  return null;
}

/**
 * Re-derive `ADMIN_KEY` inline from `env.sh`'s helpers (NOT
 * `generate-admin-key.sh`, which echoes a dashboard banner that would leak the
 * key into stdout). `2>&1` merges stderr so a function-not-found / auth error is
 * captured for the caller. No banner-stripping grep: callers extract the
 * trailing JSON via `parseTrailingJson`, which is robust to banner noise.
 */
function buildScript(fn: string, timeoutS: number): string {
  return `set -eo pipefail
source /app/env.sh
env_normalize_common
ensure_instance_secret
ADMIN_KEY=$(generate_key "$INSTANCE_NAME" "$INSTANCE_SECRET")
cd /app
HOME=/home/app timeout ${timeoutS} bunx convex run \\
  ${fn} \\
  --url "\${CONVEX_URL:-http://convex:3210}" \\
  --admin-key "$ADMIN_KEY" \\
  --no-push 2>&1
`;
}

/**
 * Invoke a deployed Convex function (no args) with the admin key, via the
 * platform container. Returns the raw `ExecResult` — `success` reflects the
 * `bunx convex run` exit code; `stdout` carries the function's JSON return value
 * (plus banner noise). Resolve the container once and pass it in to avoid a
 * lookup per poll.
 */
export async function runConvexAdmin(
  fn: string,
  opts: { container?: string; timeoutS?: number } = {},
): Promise<ExecResult> {
  const container = opts.container ?? (await findPlatformContainer());
  return exec('docker', ['exec', '-i', container, 'bash', '-s'], {
    stdin: buildScript(fn, opts.timeoutS ?? DEFAULT_TIMEOUT_S),
  });
}

/**
 * Extract the trailing JSON value from mixed stdout (`bunx convex run` prints
 * the return value after decorative banner lines). Walks backward for the first
 * line that begins a parseable value matching `isT`. Object-shaped values only
 * (the predicate enforces the shape), so a banner line containing a stray `{`
 * never mis-parses.
 */
export function parseTrailingJson<T>(
  stdout: string,
  isT: (value: unknown) => value is T,
): T | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  const lines = trimmed.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const candidate = lines[i].trimStart();
    if (!candidate.startsWith('{')) continue;
    const slice = lines.slice(i).join('\n');
    try {
      const parsed: unknown = JSON.parse(slice);
      if (isT(parsed)) return parsed;
    } catch {
      // Not a complete JSON value starting here; try an earlier line.
    }
  }
  return null;
}

// Self-hosted Convex admin keys are `<INSTANCE_NAME>|<base64>` — the charset
// includes `|` so the redactor doesn't stop at the first pipe and leak the tail.
const ADMIN_KEY_RE =
  /\b([Aa]dmin[\s\-_][Kk]ey)\s*[:=]?\s*[A-Za-z0-9+/=._\-|]{12,}/g;
const ADMIN_KEY_ARG_RE = /--admin-key([\s=]+)\S+/g;

/** Defense-in-depth: strip any admin-key value before logging captured output. */
export function redactAdminKey(text: string): string {
  return text
    .replace(ADMIN_KEY_RE, '$1: <redacted>')
    .replace(ADMIN_KEY_ARG_RE, '--admin-key$1<redacted>');
}
