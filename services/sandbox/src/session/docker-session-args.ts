// Canonical `docker run` argv builder for SESSION containers.
//
// Separate from docker-args.ts on purpose: the one-shot builder is snapshot-
// tested as a frozen contract and must not change. Sessions differ in ways
// that would break that snapshot — detached (`-d`), no entry positional (the
// daemon is PID 1 via the `daemon` entrypoint dispatch), a long-lived
// resource profile (no cpu-time ulimit, bigger mem/pids, /dev/shm for
// Chromium), the per-session runnerd token in env, and the session label.
//
// SECURITY: same discipline as docker-args.ts — every interpolated value is
// regex-validated here so a regression upstream can't turn an argv position
// into a container-escape primitive. User code is NEVER in argv; it arrives
// over the runnerd HTTP API after the container is up.

import type { SessionAgentProfileConfig, SpawnerConfig } from '../types.ts';
import type { SandboxSessionProfile } from '../wire.ts';
import { sessionContainerName } from './session-naming.ts';

interface DockerSessionRunInput {
  sessionId: string;
  organizationId: string;
  profile: SandboxSessionProfile;
  /** Host dir bind-mounted 1:1 at /workspace (survives container death). */
  workspaceHostDir: string;
  /** Per-org pip/npm/bun cache volume names (pip/npm reused from one-shot). */
  pipCacheVolume: string;
  npmCacheVolume: string;
  bunCacheVolume: string;
  /** Per-session runnerd auth token (deriveRunnerdToken). */
  runnerdToken: string;
  createdAtMs: number;
}

const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const ORG_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const VOL_RE = /^[a-zA-Z0-9_.-]{1,128}$/;
const HOST_DIR_RE = /^\/[a-zA-Z0-9_./-]{1,256}$/;
// Hex token from deriveRunnerdToken (SHA256 → 64 hex chars), or empty in
// unsigned dev mode (runnerd skips the check when TALE_RUNNERD_TOKEN is empty).
const TOKEN_RE = /^[a-f0-9]{0,128}$/;
const USER_RE = /^[0-9]{1,10}:[0-9]{1,10}$/;
const MEM_RE = /^[0-9]+[bkmg]?$/i;

function assertSafe(name: string, value: string, re: RegExp): void {
  if (!re.test(value)) {
    throw new Error(
      `docker-session-args: ${name} value rejected by safety regex: ${JSON.stringify(value)}`,
    );
  }
}

/** Resource caps + user for the `default` profile (mirrors the one-shot
 * limits in docker-args.ts; uid 65534). Kept here so both profiles flow
 * through one argv builder. */
const DEFAULT_PROFILE: SessionAgentProfileConfig = {
  cpus: 1,
  memory: '1500m',
  pidsLimit: 128,
  nofileSoft: 1024,
  nofileHard: 4096,
  fsizeBytes: 104857600,
  tmpfsSize: '128m',
  shmSize: '64m',
  user: '65534:65534',
  uid: 65534,
  gid: 65534,
};

export function buildDockerSessionRunArgs(
  cfg: SpawnerConfig,
  inp: DockerSessionRunInput,
): string[] {
  assertSafe('sessionId', inp.sessionId, ID_RE);
  assertSafe('organizationId', inp.organizationId, ORG_RE);
  assertSafe('pipCacheVolume', inp.pipCacheVolume, VOL_RE);
  assertSafe('npmCacheVolume', inp.npmCacheVolume, VOL_RE);
  assertSafe('bunCacheVolume', inp.bunCacheVolume, VOL_RE);
  assertSafe('workspaceHostDir', inp.workspaceHostDir, HOST_DIR_RE);
  assertSafe('runnerdToken', inp.runnerdToken, TOKEN_RE);

  const profile =
    inp.profile === 'agent' ? cfg.session.agentProfile : DEFAULT_PROFILE;
  assertSafe('profile.user', profile.user, USER_RE);
  assertSafe('profile.memory', profile.memory, MEM_RE);
  assertSafe('profile.tmpfsSize', profile.tmpfsSize, MEM_RE);
  assertSafe('profile.shmSize', profile.shmSize, MEM_RE);

  const containerName = sessionContainerName(inp.sessionId);
  return [
    'run',
    '-d',
    `--runtime=${cfg.runtime}`,
    '--name',
    containerName,
    // Distinct label from the one-shot `tale.sandbox=1` so cleanup.ts's
    // one-shot sweep never reaps a session; labels also carry the re-adopt
    // metadata read on boot.
    '--label',
    'tale.sandbox-session=1',
    '--label',
    `tale.session=${inp.sessionId}`,
    '--label',
    `tale.org=${inp.organizationId}`,
    '--label',
    `tale.profile=${inp.profile}`,
    '--label',
    `tale.created=${inp.createdAtMs}`,
    '--network',
    cfg.egressNetwork,
    '--env',
    `HTTPS_PROXY=${cfg.egressProxy}`,
    '--env',
    `HTTP_PROXY=${cfg.egressProxy}`,
    // Session execs reach the LLM gateway (bifrost) and the convex http-actions
    // (the in-sandbox integration bridge → /api/integrations/*) directly on the
    // internal bridge — not through tinyproxy. The agent adapters set
    // ANTHROPIC_BASE_URL at the gateway and the bridge calls http://convex:3211,
    // so both must be in NO_PROXY or the CONNECT would be denied. If
    // EXTERNAL_AGENT_INTEGRATIONS_URL overrides the host, this list must match.
    '--env',
    `NO_PROXY=127.0.0.1,localhost,bifrost,convex`,
    '--env',
    `PIP_CACHE_DIR=/cache/pip`,
    '--env',
    `UV_CACHE_DIR=/cache/pip`,
    '--env',
    `NPM_CONFIG_CACHE=/cache/npm`,
    // bun's package cache on the shared per-org volume too (else it falls to
    // ~/.bun inside the per-user workspace — unmanaged + not reused across
    // sessions). bun honors this; install temp follows TMPDIR (workspace disk).
    '--env',
    `BUN_INSTALL_CACHE_DIR=/cache/bun`,
    // HOME on the persistent workspace volume so agent state (~/.claude,
    // ~/.config/opencode, ~/.gitconfig) survives every exec + restart.
    '--env',
    `HOME=/workspace/.home`,
    // Per-session runnerd auth. Empty in unsigned dev mode (runnerd skips the
    // check); a real hex token otherwise.
    '--env',
    `TALE_RUNNERD_TOKEN=${inp.runnerdToken}`,
    `--cpus=${profile.cpus}`,
    `--memory=${profile.memory}`,
    `--memory-swap=${profile.memory}`,
    `--pids-limit=${profile.pidsLimit}`,
    '--log-driver=json-file',
    '--log-opt',
    'max-size=10m',
    '--log-opt',
    'max-file=1',
    '--ulimit',
    `nofile=${profile.nofileSoft}:${profile.nofileHard}`,
    '--ulimit',
    `fsize=${profile.fsizeBytes}`,
    // NO `--ulimit cpu`: a cumulative CPU-time cap would kill a long-lived
    // session daemon mid-build. Runaway CPU is bounded by --cpus shares +
    // per-exec timeouts + session TTL instead.
    '--ulimit',
    'core=0:0',
    '--oom-score-adj=500',
    '--read-only',
    '--tmpfs',
    `/tmp:exec,nosuid,nodev,size=${profile.tmpfsSize}`,
    // /dev/shm: Docker's 64m default crashes Chromium under Playwright.
    `--shm-size=${profile.shmSize}`,
    '--mount',
    `type=bind,src=${inp.workspaceHostDir},dst=/workspace`,
    '--cap-drop=ALL',
    '--security-opt',
    'no-new-privileges',
    '--security-opt',
    'apparmor=docker-default',
    '--user',
    profile.user,
    '--mount',
    `type=volume,src=${inp.pipCacheVolume},dst=/cache/pip`,
    '--mount',
    `type=volume,src=${inp.npmCacheVolume},dst=/cache/npm`,
    '--mount',
    `type=volume,src=${inp.bunCacheVolume},dst=/cache/bun`,
    cfg.runtimeImage,
    // Entrypoint dispatch: `daemon` mode boots runnerd as PID 1 instead of
    // running a one-shot script. See sandbox-runtime/entrypoint.sh.
    'daemon',
  ];
}
