/**
 * `tale deploy --override-all` orchestration: invoke the convex-side
 * `reseedAllOrgsFromBuiltin` action via `docker exec` into the running
 * platform container. Uses the same in-container incantation as the deploy
 * entrypoint: source env.sh, ensure_instance_secret, compute the admin key
 * inline, then run the convex CLI.
 *
 * Destructive: factory-reseeds every registered org's non-secret config
 * from the builtin catalog. `*.secrets.json` files and `.history/` trails
 * are preserved server-side by `scaffoldNewOrganization({override:true,
 * strict:true})`. Uploaded branding `images/` survive (branding is
 * treated as a tree with per-file overwrite). Everything else under each
 * `<org>/<domain>/` is overwritten with builtin content.
 *
 * Filesystem-only org subtrees (no Better Auth row) are NOT touched —
 * `--override-all` means "all registered orgs", not "every dir on disk".
 *
 * Failure semantics: the convex-side action throws on any per-org failure
 * (so `bunx convex run` exits non-zero), which surfaces as
 * `result.success === false` here and is converted to a CLI throw with
 * the per-org detail attached.
 */

import { confirm } from '../../utils/confirm';
import * as logger from '../../utils/logger';
import { exec } from '../docker/exec';
import { findPlatformContainer } from '../docker/find-platform-container';

interface ReseedAllOrgsOptions {
  dryRun: boolean;
  assumeYes: boolean;
}

/**
 * The bash script piped into the platform container. Uses the deploy
 * entrypoint's env-sourcing pattern so
 * `INSTANCE_SECRET` is guaranteed populated and the admin key derivation
 * matches the entrypoint's own runtime computation.
 *
 * `--no-push` skips a redundant push step (we're calling an existing
 * deployed action). The trailing `grep -v` strips `bunx convex run`'s
 * decorative banner output ("Admin key", "📋", "✅ Admin", separators,
 * blank lines, etc.) so the final stdout is the action's JSON return
 * value alone — parseable in TypeScript.
 *
 * Runtime workdir is `/app` (services/platform/Dockerfile sets
 * `WORKDIR /app`; flattens services/platform/{convex,lib,env.sh,…} into
 * `/app/`). No `cd /app/services/platform` — that path does not exist
 * at runtime.
 */
const RESEED_TIMEOUT_S = 1800;
const RESEED_TIMEOUT_EXIT = 124;

// The shell pipeline appends `|| true` to the grep so a zero-match
// outcome (grep exits 1) does not poison `set -o pipefail`. The real
// signal is `bunx convex run`'s exit code, captured before the grep
// strips banner lines.
//
// `generate-admin-key.sh` is intentionally NOT sourced here even though
// it provides a complete admin-key derivation routine — the script also
// echoes a dashboard banner including a `   Admin Key:      <key>` line
// that would land in our captured stdout. Sourcing once leaked the key
// past the line-based grep filter (the grep anchored on `^Admin key`
// which mis-matched the lower-case 'k' AND the 3-space indent). Re-
// derive ADMIN_KEY inline from env.sh's helpers (`ensure_instance_secret`
// is exported by env.sh; `generate_key` is the binary on $PATH that the
// official Convex Docker image uses).
const RESEED_SCRIPT = `set -eo pipefail
source /app/env.sh
env_normalize_common
ensure_instance_secret
ADMIN_KEY=$(generate_key "$INSTANCE_NAME" "$INSTANCE_SECRET")
cd /app
HOME=/home/app timeout ${RESEED_TIMEOUT_S} bunx convex run \\
  organizations/reseed_all_orgs:reseedAllOrgsFromBuiltin \\
  --url "\${CONVEX_URL:-http://convex:3210}" \\
  --admin-key "$ADMIN_KEY" \\
  --no-push 2>&1 \\
  | { grep -v "^Admin key\\|^📋\\|^✅ Admin\\|^━\\|^🌐\\|^$\\|Steps:\\|Open\\|Enter\\|Paste" || true; }
`;

/**
 * Defense-in-depth redactor for the captured `bunx convex run` stdout.
 * If anything upstream (env.sh's diagnostic mode, a future Convex CLI
 * banner, etc.) prints an admin-key line that slips past the bash grep,
 * this regex strips it before the value reaches the logger. Case-
 * insensitive, anchors on any leading whitespace.
 *
 * Charset includes `|` because self-hosted Convex admin keys are
 * formatted `<INSTANCE_NAME>|<base64-payload>` (e.g.
 * `tale_platform|01abc...`). Without the pipe the regex matched only
 * up to the first `|`, leaving the secret payload after it in the
 * logged stream (round-3 P1-adjacent secret leak).
 */
const ADMIN_KEY_RE =
  /\b([Aa]dmin[\s\-_][Kk]ey)\s*[:=]?\s*[A-Za-z0-9+/=._\-|]{12,}/g;

/**
 * Catch the hyphenated argv form (`--admin-key <value>`) used by
 * `bunx convex run --admin-key …`. The `[Aa]dmin\s+[Kk]ey` shape
 * above requires whitespace between "Admin" and "Key" and so misses
 * `--admin-key`. Without this second pattern, a future Convex CLI
 * diagnostic line echoing its argv would slip the secret past the
 * redactor and into the logger.
 */
const ADMIN_KEY_ARG_RE = /--admin-key([\s=]+)\S+/g;

export function redactAdminKey(text: string): string {
  return text
    .replace(ADMIN_KEY_RE, '$1: <redacted>')
    .replace(ADMIN_KEY_ARG_RE, '--admin-key$1<redacted>');
}

const CONFIRM_MESSAGE =
  '--override-all will factory-reset every registered org from the builtin catalog. ' +
  '*.secrets.json files, .history/ trails, and uploaded branding/images/ are preserved; ' +
  'all other config (model lists, agents, workflows, skills, integrations, branding.json, governance policies + retention.json) ' +
  'is overwritten. Proceed?';

type ReseedResult = {
  total: number;
  succeeded: number;
  failed: number;
  results: Array<
    | { slug: string; status: 'ok' }
    | { slug: string; status: 'error'; error: string }
  >;
};

/**
 * Extract the trailing JSON object from a stream of mixed-output stdout.
 * `bunx convex run` prints `null` for void-returning actions or the
 * action's return value for value-returning ones. We want the LAST
 * line(s) that form a parseable JSON object whose shape matches
 * `ReseedResult` — not just "anything after the last `{`", which would
 * mis-parse when per-org error strings include `{` (e.g. a JS object
 * literal in an error message).
 *
 * Strategy:
 *   1. Split into lines.
 *   2. Walk backwards; for each starting line that begins with `{`,
 *      try `JSON.parse(joinedSlice)`.
 *   3. First parse that produces a shape-validated ReseedResult wins.
 */
function parseTrailingJson(stdout: string): ReseedResult | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;

  const lines = trimmed.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const candidate = lines[i].trimStart();
    if (!candidate.startsWith('{')) continue;
    const slice = lines.slice(i).join('\n');
    try {
      const parsed: unknown = JSON.parse(slice);
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof (parsed as Record<string, unknown>).total === 'number' &&
        typeof (parsed as Record<string, unknown>).succeeded === 'number' &&
        typeof (parsed as Record<string, unknown>).failed === 'number' &&
        Array.isArray((parsed as Record<string, unknown>).results)
      ) {
        return parsed as ReseedResult;
      }
    } catch {
      // Not a complete JSON value starting at this line; try earlier.
    }
  }
  return null;
}

export async function reseedAllOrgsFromBuiltin(
  options: ReseedAllOrgsOptions,
): Promise<void> {
  const { dryRun, assumeYes } = options;

  // Dry-run gate sits BEFORE the destructive confirm prompt + the
  // platform-container lookup. Otherwise `tale deploy --override-all
  // --dry-run` would (a) still ask the operator to confirm a
  // destructive-shape operation that won't run, and (b) hard-throw
  // on hosts where no platform container is up yet — defeating the
  // point of a dry-run preview.
  if (dryRun) {
    logger.blank();
    logger.info(
      '[DRY-RUN] Would run reseed script against the platform container:',
    );
    for (const line of RESEED_SCRIPT.split('\n')) {
      logger.info(`  ${line}`);
    }
    return;
  }

  // Gate non-interactive callers behind --yes to avoid silent abort in CI.
  const isTty = Boolean(process.stdin.isTTY);
  if (!assumeYes && !isTty) {
    throw new Error(
      '--override-all requires --yes (-y) when stdin is not a TTY (e.g. CI).',
    );
  }
  if (!assumeYes && isTty) {
    const ok = await confirm(CONFIRM_MESSAGE);
    if (!ok) {
      logger.info('Aborted by user.');
      return;
    }
  }

  const container = await findPlatformContainer();

  logger.blank();
  logger.step('Reseeding builtin catalog into all registered orgs...');

  // Pipe the script via stdin instead of embedding in argv — avoids shell
  // escaping pitfalls and keeps the script source readable.
  const result = await exec('docker', ['exec', '-i', container, 'bash', '-s'], {
    stdin: RESEED_SCRIPT,
  });

  // The convex action throws on any per-org failure, which propagates to
  // `bunx convex run`'s exit code, which propagates to `docker exec`'s
  // exit code, which becomes `result.success === false` here.
  if (!result.success) {
    if (result.stdout) {
      logger.info(redactAdminKey(result.stdout.trim()));
    }
    if (result.stderr) {
      logger.error(redactAdminKey(result.stderr.trim()));
    }

    // Special-case `timeout(1)`'s SIGTERM exit so the operator sees
    // "timed out" rather than a generic "raised". The action is
    // idempotent so re-running is always safe.
    if (result.exitCode === RESEED_TIMEOUT_EXIT) {
      throw new Error(
        `--override-all timed out after ${RESEED_TIMEOUT_S}s in ${container}. ` +
          `The reseed action may still be running on the convex side; ` +
          `wait a minute, then re-run (idempotent).`,
      );
    }

    // The convex-side action `console.log`s a human-readable failure
    // summary then `throw`s — `bunx convex run` does NOT emit the
    // action's return value on the throw path, so any attempt to parse
    // structured failure detail here is dead code. The stdout logged
    // above already surfaces the per-slug detail to the operator / CI.
    throw new Error(
      `--override-all failed: reseed action raised in ${container}. ` +
        `Per-org detail above; partial state on disk — re-run --override-all ` +
        `after addressing failures (the action is idempotent).`,
    );
  }

  // All orgs succeeded. Parse and summarize.
  const parsed = parseTrailingJson(result.stdout);
  if (parsed) {
    logger.info(
      `Reseeded ${parsed.succeeded}/${parsed.total} orgs from builtin catalog.`,
    );
  } else if (result.stdout) {
    // Couldn't parse — surface raw stdout (redacted) so the operator
    // isn't flying blind. Should be rare given the grep strip above.
    logger.info(redactAdminKey(result.stdout.trim()));
  }

  logger.success('Reseed complete.');
}
