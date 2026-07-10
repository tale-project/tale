/**
 * Shared "run a deployed Convex function with the admin key" channel.
 *
 * The platform container holds the convex CLI plus the env (`INSTANCE_NAME` /
 * `INSTANCE_SECRET`) needed to derive the admin key, and reaches the convex
 * backend over the internal network at `http://convex:3210`. Every CLI →
 * Convex control call (`tale migrate` status/up/down, `--override-all`
 * reseed, deploy drain) pipes the same incantation into
 * `docker exec -i <platform> bash -s`: source `env.sh`, derive `ADMIN_KEY`,
 * then run `bunx convex run <fn>`.
 *
 * Transport contract: `bunx convex run` prints the function's return value
 * ALONE to stdout; decorative banners and function `console.*` logs go to
 * stderr. The two streams are never merged. The script captures the return
 * value and re-emits it framed between {@link RESULT_BEGIN} and
 * {@link RESULT_END} lines, so incidental stdout noise from `env.sh` sourcing
 * can never corrupt the payload — {@link parseSentinelJson} slices between
 * the sentinels and `JSON.parse`s, with zero banner heuristics. (The pre-v2
 * transport merged stderr into stdout and grep-stripped banner lines, which
 * corrupted JSON whose content matched a banner prefix — e.g. migration
 * titles containing "Enterprise" or "OpenRouter".)
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

/** First line of the framed function result on stdout. */
export const RESULT_BEGIN = '__TALE_CONVEX_RESULT_BEGIN__';
/** Line terminating the framed function result on stdout. */
export const RESULT_END = '__TALE_CONVEX_RESULT_END__';

/**
 * Function references are static strings in this codebase
 * (`migrations/framework/entrypoints:applyUp`, `control/drain:beginDrain`, …).
 * Validated before interpolation into the bash script as defense-in-depth.
 */
const SAFE_FN_RE = /^[A-Za-z0-9_/.:-]+$/;

/**
 * Args reach `bunx convex run <fn> '<json>'` as a single-quoted JSON literal.
 * Our args are version strings, id arrays, and booleans, so the serialized
 * value is restricted to this charset — a defense-in-depth guard against
 * shell injection should a future caller pass something exotic.
 */
const SAFE_ARGS_RE = /^[A-Za-z0-9_,[\]{}":. /\\-]*$/;

interface ConvexRunScriptOptions {
  /** Optional function args object, serialized and charset-guarded. */
  args?: Record<string, unknown>;
  /** In-container `timeout(1)` budget for the run. Default 120s. */
  timeoutS?: number;
}

/**
 * Build the bash script piped into the platform container. Re-derives
 * `ADMIN_KEY` inline from `env.sh`'s helpers (NOT `generate-admin-key.sh`,
 * which echoes a dashboard banner that would leak the key into stdout).
 * stderr flows through untouched — `docker exec` relays it into
 * `ExecResult.stderr` for diagnostics; stdout carries only the sentinel-framed
 * return value (plus any pre-frame `env.sh` noise the parser ignores).
 *
 * The `set +e` bracket keeps a non-zero `bunx convex run` from aborting the
 * script before the sentinels are printed; the real exit code is preserved
 * and re-raised at the end (so `timeout`'s 124 reaches callers unchanged).
 */
// The first line is a bash comment that acts as the bundle sentinel for
// scripts/check-bundle.ts. It exists ONLY inside this template literal —
// never repeat it in a comment or another string, or the post-build binary
// check can pass while the script itself regressed to a runtime fs read
// (which `bun --compile` does not bundle).
export function buildConvexRunScript(
  fn: string,
  opts: ConvexRunScriptOptions = {},
): string {
  if (!SAFE_FN_RE.test(fn)) {
    throw new Error(`Refusing to run unsafe convex function ref: ${fn}`);
  }
  let argsLiteral = '';
  if (opts.args !== undefined) {
    const json = JSON.stringify(opts.args);
    if (!SAFE_ARGS_RE.test(json)) {
      throw new Error(`Refusing to pass unsafe convex run args: ${json}`);
    }
    argsLiteral = ` '${json}'`;
  }
  const timeoutS = opts.timeoutS ?? DEFAULT_TIMEOUT_S;
  return `# tale-bundle-sentinel:convex-run-script-v2
set -eo pipefail
source /app/env.sh
env_normalize_common
ensure_instance_secret
ADMIN_KEY=$(generate_key "$INSTANCE_NAME" "$INSTANCE_SECRET")
cd /app
set +e
RESULT=$(HOME=/home/app timeout ${timeoutS} bunx convex run \\
  ${fn}${argsLiteral} \\
  --url "\${CONVEX_URL:-http://convex:3210}" \\
  --admin-key "$ADMIN_KEY" \\
  --no-push)
STATUS=$?
set -e
echo "${RESULT_BEGIN}"
printf '%s\\n' "$RESULT"
echo "${RESULT_END}"
exit $STATUS
`;
}

/**
 * Slice the sentinel-framed function result out of captured stdout. Returns
 * `null` when the frame is absent (the script died before printing it — bad
 * env, missing container tooling); callers surface the raw output instead.
 */
export function extractSentinelResult(stdout: string): string | null {
  const beginAt = stdout.indexOf(RESULT_BEGIN);
  if (beginAt < 0) return null;
  const frameStart = stdout.indexOf('\n', beginAt);
  if (frameStart < 0) return null;
  const endAt = stdout.indexOf(RESULT_END, frameStart);
  if (endAt < 0) return null;
  const raw = stdout.slice(frameStart + 1, endAt);
  // Drop the single newline `printf '%s\n'` appends before the END line.
  return raw.endsWith('\n') ? raw.slice(0, -1) : raw;
}

/**
 * Parse the sentinel-framed JSON return value from captured stdout. Returns
 * `null` when the frame is missing, empty, or not valid JSON — and also for a
 * function that genuinely returned `null`; callers that must distinguish use
 * {@link extractSentinelResult} directly or a shape guard on the value.
 */
export function parseSentinelJson<T>(stdout: string): T | null {
  const framed = extractSentinelResult(stdout);
  if (framed === null) return null;
  const trimmed = framed.trim();
  if (!trimmed) return null;
  try {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- caller declares contract
    return JSON.parse(trimmed) as T;
  } catch {
    // A frame that isn't JSON means the backend printed something unexpected;
    // callers treat null as "unparseable" and surface the raw output.
    return null;
  }
}

/**
 * Invoke a deployed Convex function (no args) with the admin key, via the
 * platform container. Returns the raw `ExecResult` — `success` reflects the
 * `bunx convex run` exit code; `stdout` carries the sentinel-framed return
 * value (extract with {@link parseSentinelJson}); `stderr` carries banners and
 * the function's `console.*` logs. Resolve the container once and pass it in
 * to avoid a lookup per poll.
 */
export async function runConvexAdmin(
  fn: string,
  opts: { container?: string; timeoutS?: number } = {},
): Promise<ExecResult> {
  const container = opts.container ?? (await findPlatformContainer());
  return exec('docker', ['exec', '-i', container, 'bash', '-s'], {
    stdin: buildConvexRunScript(fn, { timeoutS: opts.timeoutS }),
  });
}

const BANNER_LINE_RE =
  /^(?:Admin key|📋|✅ Admin|━|🌐|Steps:|Open|Enter|Paste)|^$/;

/**
 * Strip known `bunx convex run` decorative banner lines. DISPLAY-ONLY: used to
 * de-noise captured stderr before relaying the function's `console.*` logs to
 * the operator. Never used on the result payload — that is sentinel-framed on
 * stdout and parsed by {@link parseSentinelJson}, so an over-eager match here
 * can no longer corrupt data.
 */
export function stripConvexBannerLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => !BANNER_LINE_RE.test(line))
    .join('\n');
}

// Self-hosted Convex admin keys are `<INSTANCE_NAME>|<base64>` — the charset
// includes `|` so the redactor doesn't stop at the first pipe and leak the tail.
const ADMIN_KEY_RE =
  /\b([Aa]dmin[\s\-_][Kk]ey)\s*[:=]?\s*[A-Za-z0-9+/=._\-|]{12,}/g;

// Catch the hyphenated argv form (`--admin-key <value>`) used by
// `bunx convex run --admin-key …`: the pattern above requires whitespace
// between "Admin" and "Key" and so misses it. Without this second pattern, a
// Convex CLI diagnostic line echoing its argv would slip the secret past the
// redactor and into the logger.
const ADMIN_KEY_ARG_RE = /--admin-key([\s=]+)\S+/g;

/** Defense-in-depth: strip any admin-key value before logging captured output. */
export function redactAdminKey(text: string): string {
  return text
    .replace(ADMIN_KEY_RE, '$1: <redacted>')
    .replace(ADMIN_KEY_ARG_RE, '--admin-key$1<redacted>');
}
