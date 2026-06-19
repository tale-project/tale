// Canonical `docker run` argv builder.
//
// Pure function so the unit test (R1.22 #1 regression gate) can snapshot the
// argv without invoking docker. CRITICAL: user code is NEVER passed via argv
// — it's staged via a host bind-mount that maps /var/lib/tale-sandbox/
// sessions/<id>/ into /user inside the container (see
// spawn.ts:stageWorkspace). Only typed identifiers (UUID, orgId after
// validation, language, image) reach argv positions.

import { dockerRuntimeFor } from './runtime-tier.ts';
import type { Language, SpawnerConfig } from './types.ts';

interface DockerRunInput {
  executionId: string;
  organizationId: string;
  language: Language;
  timeoutMs: number;
  pipCacheVolume: string;
  npmCacheVolume: string;
  // Host path (1:1 mounted into the spawner) that becomes /user inside
  // the runtime container. Used instead of --tmpfs because docker cp cannot
  // read from tmpfs mounts and we need to harvest files from /user/output
  // after the container exits.
  workspaceHostDir: string;
  startedAtMs: number;
  /**
   * Path the runtime entrypoint will exec(). Either a relative POSIX path
   * resolved under /user/code/ (single-script mode, points at the
   * user's file), or an absolute path under /user/.runtime/tale/ (multi-step
   * mode, points at the spawner-generated wrapper). The entrypoint
   * rejects anything outside those two roots.
   */
  entryPath: string;
  /**
   * Sanitized step-scoped env (reserved names already dropped upstream by
   * validate-request). Emitted as extra `--env KEY=VALUE` flags. Defense in
   * depth: re-checked here against the env-name regex + the infrastructure
   * baseline names, so a user key can never shadow the proxy/cache/HOME vars.
   */
  userEnv?: Record<string, string>;
}

// Infrastructure env the runtime depends on — a user-supplied step env must
// never shadow these (would break egress/caching or unwrite HOME). Names that
// collide are skipped (validate-request already drops the security-critical
// ones; this is the last line of defense for the cache vars too).
// Uppercase; the collision check normalizes the candidate name so a lowercase
// variant can't sneak past. Includes the canonical reserved names (HOME/PATH/
// TMPDIR) as well as the proxy + cache vars, so this defensive layer covers the
// same ground as the upstream `isDeniedEnvName` filter.
const BASELINE_ENV_NAMES = new Set([
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  'PIP_CACHE_DIR',
  'UV_CACHE_DIR',
  'NPM_CONFIG_CACHE',
  'HOME',
  'PATH',
  'TMPDIR',
]);
// POSIX env var name (matches validate-request's ENV_NAME_RE).
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Build the `--env KEY=VALUE` flag pairs for the sanitized step env, skipping
 *  any name that collides with the infrastructure baseline or isn't a valid
 *  env identifier. `KEY=VALUE` is one argv element — `docker run` receives it
 *  via Bun.spawn's argv array (no shell), so the value is never re-parsed. */
function buildUserEnvArgs(
  userEnv: Record<string, string> | undefined,
): string[] {
  if (!userEnv) return [];
  const out: string[] = [];
  for (const [name, value] of Object.entries(userEnv)) {
    if (!ENV_NAME_RE.test(name) || BASELINE_ENV_NAMES.has(name.toUpperCase())) {
      continue;
    }
    out.push('--env', `${name}=${value}`);
  }
  return out;
}

// executionId is either a UUID (hex + hyphens) from a direct caller or a
// Convex doc id (lowercase alphanumeric). Both produce safe Docker container
// names — alphanumeric + dash/underscore only.
const UUID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const ORG_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const VOL_RE = /^[a-zA-Z0-9_.-]{1,128}$/;
const HOST_DIR_RE = /^\/[a-zA-Z0-9_./-]{1,256}$/;
// Relative POSIX-safe path (under /user/code/) OR an absolute path
// under one of the two roots the runtime entrypoint accepts
// (/user/code/ or /user/.runtime/tale/). The negative lookahead bans `..`
// segments — defense-in-depth, the spawner-side validator already strips these.
const ENTRY_PATH_RE =
  /^(?:\/user\/(?:code|\.runtime\/tale)\/(?!.*\.\.)[A-Za-z0-9_./-]{1,256}|(?!.*\.\.)[A-Za-z0-9_-][A-Za-z0-9_./-]{0,255})$/;

function assertSafe(name: string, value: string, re: RegExp): void {
  if (!re.test(value)) {
    throw new Error(
      `docker-args: ${name} value rejected by safety regex: ${JSON.stringify(value)}`,
    );
  }
}

export function buildDockerRunArgs(
  cfg: SpawnerConfig,
  inp: DockerRunInput,
): string[] {
  // Defense-in-depth: even though every caller is internal and typed, validate
  // every string that ends up in argv. A regression that lets a user-controlled
  // string land here would otherwise be a container-escape primitive.
  assertSafe('executionId', inp.executionId, UUID_RE);
  assertSafe('organizationId', inp.organizationId, ORG_RE);
  assertSafe('pipCacheVolume', inp.pipCacheVolume, VOL_RE);
  assertSafe('npmCacheVolume', inp.npmCacheVolume, VOL_RE);
  assertSafe('workspaceHostDir', inp.workspaceHostDir, HOST_DIR_RE);
  assertSafe('entryPath', inp.entryPath, ENTRY_PATH_RE);
  if (
    inp.language !== 'python' &&
    inp.language !== 'node' &&
    inp.language !== 'bash' &&
    inp.language !== 'polyglot'
  ) {
    throw new Error(`docker-args: bad language: ${inp.language as string}`);
  }

  const containerName = `tale-sbx-${inp.executionId}`;
  // No `--rm` because spawn.ts removes the container explicitly after
  // harvesting outputs from the host bind-mounted workspace dir.
  return [
    'run',
    `--runtime=${dockerRuntimeFor(cfg.runtimeTier)}`,
    '--name',
    containerName,
    '--label',
    'tale.sandbox=1',
    `--label`,
    `tale.session=${inp.executionId}`,
    `--label`,
    `tale.started=${inp.startedAtMs}`,
    `--label`,
    `tale.org=${inp.organizationId}`,
    `--network`,
    cfg.egressNetwork,
    `--env`,
    `HTTPS_PROXY=${cfg.egressProxy}`,
    `--env`,
    `HTTP_PROXY=${cfg.egressProxy}`,
    `--env`,
    `NO_PROXY=127.0.0.1,localhost`,
    `--env`,
    `PIP_CACHE_DIR=/cache/pip`,
    `--env`,
    `UV_CACHE_DIR=/cache/pip`,
    `--env`,
    `NPM_CONFIG_CACHE=/cache/npm`,
    // `--read-only` makes the nobody user's $HOME=/nonexistent un-writable;
    // every tool that touches $HOME (uv, npm, fontconfig) errors out. Point
    // HOME at the tmpfs /tmp so transient state goes somewhere writable.
    `--env`,
    `HOME=/tmp`,
    // Step-scoped env (sanitized; baseline names already filtered out) — placed
    // AFTER the infrastructure baseline so it can only ADD vars, never shadow
    // the proxy/cache/HOME the runtime depends on.
    ...buildUserEnvArgs(inp.userEnv),
    '--cpus=1',
    '--memory=1500m',
    '--memory-swap=1500m',
    '--pids-limit=128',
    // Cap the host daemon's json-file log so a runtime container that floods
    // stdout/stderr can't fill the host disk (audit finding R2-B2: spawner's
    // own log_driver only covered the spawner container, not the sibling
    // runtime containers it docker-runs). 10 MB × 1 file ≈ matches the
    // spawner-side stdout/stderr caps after compression.
    '--log-driver=json-file',
    '--log-opt',
    'max-size=10m',
    '--log-opt',
    'max-file=1',
    '--ulimit',
    'nofile=1024:4096',
    '--ulimit',
    'fsize=104857600',
    '--ulimit',
    'cpu=600',
    '--ulimit',
    'core=0:0',
    '--oom-score-adj=500',
    '--read-only',
    '--tmpfs',
    '/tmp:exec,nosuid,nodev,size=128m',
    // Workspace is a host bind mount so the spawner can write the staging
    // bundle directly from Bun fs (no tar pipe needed) and read output files
    // back via Bun fs (docker cp cannot read from --tmpfs mounts). Total
    // disk usage is capped by `--ulimit fsize` (100 MB per file) plus the
    // post-run cleanup in spawn.ts. Trades the tmpfs ENOSPC cap (R2.2) for
    // workable harvest semantics; see plan §"Trade-offs explicitly chosen".
    '--mount',
    `type=bind,src=${inp.workspaceHostDir},dst=/user`,
    '--cap-drop=ALL',
    '--security-opt',
    'no-new-privileges',
    '--security-opt',
    'apparmor=docker-default',
    // NOTE: custom seccomp profile is a v1.x hardening target. For v1 we rely
    // on Docker's built-in default profile which already blocks unshare/keyctl
    // /add_key/bpf/mount/pivot_root; see plan §"Security model".
    '--user',
    '65534:65534',
    '--mount',
    `type=volume,src=${inp.pipCacheVolume},dst=/cache/pip`,
    '--mount',
    `type=volume,src=${inp.npmCacheVolume},dst=/cache/npm`,
    // The runtime image's ENTRYPOINT is already `/entrypoint.sh`, so we only
    // pass the entrypoint's positional args here. The 4th positional is the
    // path the entrypoint will exec — see services/sandbox-runtime/entrypoint.sh.
    cfg.runtimeImage,
    inp.language,
    '/user/code/packages.json',
    '/user/code/options.json',
    inp.entryPath,
  ];
}
