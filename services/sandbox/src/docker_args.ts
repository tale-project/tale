// Canonical `docker run` argv builder.
//
// Pure function so the unit test (R1.22 #1 regression gate) can snapshot the
// argv without invoking docker. CRITICAL: user code is NEVER passed via argv
// (it's piped to the container's stdin as a tar). Only typed identifiers
// (UUID, orgId after validation, language, image) reach argv positions.

import type { Language, SpawnerConfig } from './types.ts';

export interface DockerRunInput {
  executionId: string;
  organizationId: string;
  language: Language;
  timeoutMs: number;
  pipCacheVolume: string;
  npmCacheVolume: string;
  // Host path (1:1 mounted into the spawner) that becomes /workspace inside
  // the runtime container. Used instead of --tmpfs because docker cp cannot
  // read from tmpfs mounts and we need to harvest files from /workspace/output
  // after the container exits.
  workspaceHostDir: string;
  startedAtMs: number;
}

// executionId is either a UUID (hex + hyphens) from a direct caller or a
// Convex doc id (lowercase alphanumeric). Both produce safe Docker container
// names — alphanumeric + dash/underscore only.
const UUID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const ORG_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const VOL_RE = /^[a-zA-Z0-9_.-]{1,128}$/;
const HOST_DIR_RE = /^\/[a-zA-Z0-9_./-]{1,256}$/;

function assertSafe(name: string, value: string, re: RegExp): void {
  if (!re.test(value)) {
    throw new Error(
      `docker_args: ${name} value rejected by safety regex: ${JSON.stringify(value)}`,
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
  if (inp.language !== 'python' && inp.language !== 'node') {
    throw new Error(`docker_args: bad language: ${inp.language as string}`);
  }

  const containerName = `tale-sbx-${inp.executionId}`;
  // No `--rm` because spawn.ts removes the container explicitly after
  // harvesting outputs from the host bind-mounted workspace dir.
  return [
    'run',
    `--runtime=${cfg.runtime}`,
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
    '--cpus=1',
    '--memory=1500m',
    '--memory-swap=1500m',
    '--pids-limit=128',
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
    `type=bind,src=${inp.workspaceHostDir},dst=/workspace`,
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
    // pass the entrypoint's positional args here.
    cfg.runtimeImage,
    inp.language,
    '/workspace/code/packages.json',
    '/workspace/code/options.json',
  ];
}
