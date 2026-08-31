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

import {
  dindCapabilityOf,
  dockerRuntimeFor,
  transparentEgressSupported,
} from '../runtime-tier.ts';
import type { SessionAgentProfileConfig, SpawnerConfig } from '../types.ts';
import type { SandboxSessionProfile } from '../wire.ts';
import { sessionContainerName } from './session-naming.ts';

interface DockerSessionRunInput {
  sessionId: string;
  organizationId: string;
  profile: SandboxSessionProfile;
  /** Host dir bind-mounted 1:1 at /agent (survives container death). */
  workspaceHostDir: string;
  /** Per-org pip/npm/bun cache volume names (pip/npm reused from one-shot). */
  pipCacheVolume: string;
  npmCacheVolume: string;
  bunCacheVolume: string;
  /** Per-session runnerd auth token (deriveRunnerdToken). */
  runnerdToken: string;
  createdAtMs: number;
  /**
   * Per-session docker storage volume name, mounted at /var/lib/docker. Required
   * (and only used) when `sessionDindEnabled` — DinD is agent-profile only; the
   * backend creates an ephemeral, size-bounded volume so the inner dockerd's
   * image/layer store is isolated per session and doesn't share the
   * (overlay-backed) workspace.
   */
  dockerStorageVolume?: string;
  /**
   * Endpoint of the shared buildkitd (e.g. `tcp://tale-buildkitd:1234`), set only
   * when `cfg.dockerBuildCache` is on (and DinD). The entrypoint creates a remote
   * buildx builder pointing here + sets BUILDX_BUILDER, so the session's
   * `docker build` / `docker compose up --build` reuse the shared build cache.
   * Undefined ⇒ no TALE_BUILDKITD_ENDPOINT env (argv byte-identical).
   */
  buildkitdEndpoint?: string;
}

const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const ORG_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const VOL_RE = /^[a-zA-Z0-9_.-]{1,128}$/;
// `tcp://host:port` for the shared buildkitd endpoint — the only injection
// surface a new env value adds, so validate it like every other interpolation.
const ENDPOINT_RE = /^tcp:\/\/[a-zA-Z0-9_.-]{1,128}:[0-9]{1,5}$/;
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

/**
 * DinD is an AGENT-profile capability, never a `default`-profile one. The
 * `default` profile is the hardened run_code posture (untrusted user code,
 * uid 65534): giving it the DinD boot would (a) hand untrusted code a
 * `--privileged` container on the runc tier, and (b) crash the session —
 * the entrypoint's DinD branch setpriv-drops to the agent uid (10001)
 * unconditionally, which cannot write the 65534-owned workspace, so the
 * skeleton mkdir dies and runnerd never comes up. Gating here (not in the
 * caller) keeps the argv builder and the backend's volume/buildkitd setup in
 * lockstep.
 */
export function sessionDindEnabled(
  cfg: SpawnerConfig,
  profile: SandboxSessionProfile,
): boolean {
  return cfg.dockerInContainer && profile === 'agent';
}

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

  // Docker-in-container mode. The inner dockerd needs a rootful init, so the
  // container starts as uid 0 (the entrypoint drops back to uid 10001 for
  // runnerd once dockerd is up) and the hardened flags are relaxed — HOW they're
  // relaxed depends on the tier's boundary:
  //   sysbox/kata ('native'/'vm') — keep cap-drop off + apparmor=unconfined;
  //     the per-container userns / guest VM is the real boundary (no --privileged).
  //   runc ('privileged') — --privileged; NO boundary (in-container root = host
  //     root). config.ts allows this only with a loud trusted-only warning.
  // When !dind every conditional collapses to today's hardened argv (byte-for-
  // byte, unit-tested).
  const dind = sessionDindEnabled(cfg, inp.profile);
  const dindMode = dindCapabilityOf(cfg.runtimeTier);

  // Transparent egress for the session's OWN processes. The entrypoint installs
  // an iptables OUTPUT REDIRECT → redsocks so any client (Node/undici, Go static
  // binaries, raw sockets) egresses through the proxy with zero proxy-env
  // awareness. Gated off on gvisor (runsc netstack makes the REDIRECT unreliable).
  //   transparentEgress         — emit the TALE_TRANSPARENT_EGRESS=1 signal;
  //     applies to BOTH paths (the entrypoint installs the OUTPUT hook inline on
  //     non-DinD, and after the inner dockerd is up on DinD).
  //   transparentEgressHardening — the boot-as-root + NET_ADMIN/NET_RAW argv
  //     change; ONLY the non-DinD path needs it (DinD already boots root with
  //     the caps it needs, so its argv is unchanged).
  const transparentEgress =
    cfg.transparentEgress && transparentEgressSupported(cfg.runtimeTier);
  const transparentEgressHardening = transparentEgress && !dind;

  let hardeningFlags: string[];
  if (dind) {
    if (dindMode === 'privileged') {
      // nosemgrep: tools.opengrep.rules.trailofbits.generic.container-privileged.container-privileged -- intentional: trusted-only `runc` DinD runtime tier (no isolation boundary by design); config.ts gates this behind a loud trusted-only opt-in warning
      hardeningFlags = ['--privileged'];
    } else {
      hardeningFlags = ['--security-opt', 'apparmor=unconfined'];
    }
  } else if (transparentEgressHardening) {
    // Boot caps, far less than --privileged: NET_ADMIN/NET_RAW for the iptables
    // OUTPUT REDIRECT, plus SETUID/SETGID so the entrypoint can setpriv-drop from
    // root to the profile uid (setresuid to an unrelated uid needs CAP_SETUID).
    // ALL of these are exercised ONLY by PID 1 (the entrypoint) at boot — the
    // kernel clears the cap set when setpriv changes the uid, so the runnerd +
    // every user process that follows runs fully capless. no-new-privileges is
    // kept: the setpriv drop is a privilege REDUCTION, which the flag permits.
    hardeningFlags = [
      '--cap-drop=ALL',
      '--cap-add=NET_ADMIN',
      '--cap-add=NET_RAW',
      '--cap-add=SETUID',
      '--cap-add=SETGID',
      '--security-opt',
      'no-new-privileges',
      '--security-opt',
      'apparmor=docker-default',
    ];
  } else {
    hardeningFlags = [
      '--cap-drop=ALL',
      '--security-opt',
      'no-new-privileges',
      '--security-opt',
      'apparmor=docker-default',
    ];
  }
  // DinD and the transparent-egress hardening both boot as root (uid 0); the
  // entrypoint drops to the profile uid via setpriv. Plain hardened sessions run
  // as the profile uid directly.
  // nosemgrep: tools.opengrep.rules.trailofbits.generic.container-user-root.container-user-root -- intentional: DinD/transparent-egress containers start as root only so the entrypoint can launch the inner dockerd / install the iptables OUTPUT hook; setpriv then drops back to the profile uid for runnerd
  const userValue = dind || transparentEgressHardening ? '0:0' : profile.user;
  // dockerd needs a writable rootfs (/var/run, /etc/docker, etc.); /var/lib/
  // docker is a dedicated volume (below). Non-dind keeps the read-only root —
  // transparent egress writes redsocks.conf to the /tmp tmpfs, so --read-only
  // stays even on that path.
  const readOnlyFlag = dind ? [] : ['--read-only'];

  // Ulimits. The inner dockerd inherits these from the session container, so the
  // agent profile's per-file `fsize` cap (512 MiB) would make layer extraction
  // fail with EFBIG on any image shipping a single file larger than the cap —
  // e.g. paradedb's >512 MiB `pg_search.so.dbg` debug symbols. Under DinD the
  // per-file ceiling is also the wrong disk-DoS lever (the real bound is the
  // dedicated /var/lib/docker volume quota), so drop it entirely; and dockerd
  // needs a daemon-class fd budget, so raise `nofile` to its customary range.
  // Non-DinD keeps today's caps verbatim (the byte-identical-argv unit test
  // depends on this branch staying unchanged).
  // NO `--ulimit cpu` on either branch: a cumulative CPU-time cap would kill a
  // long-lived session daemon mid-build; runaway CPU is bounded by --cpus shares
  // + per-exec timeouts + session TTL instead.
  const ulimitFlags = dind
    ? [
        '--ulimit',
        `nofile=${Math.max(profile.nofileSoft, 65536)}:${Math.max(profile.nofileHard, 1048576)}`,
        '--ulimit',
        'core=0:0',
      ]
    : [
        '--ulimit',
        `nofile=${profile.nofileSoft}:${profile.nofileHard}`,
        '--ulimit',
        `fsize=${profile.fsizeBytes}`,
        '--ulimit',
        'core=0:0',
      ];

  // pids cap. Like the ulimits above, the inner dockerd + every nested build
  // step and container share the session's pids cgroup, so the agent profile's
  // 512-pid guard (sized for a single coding agent) is far too low once the
  // session hosts a parallel `docker compose build`: dockerd + containerd +
  // buildkit + N concurrent runc executors each fork apt/dpkg/bun/pip subtrees
  // and blow past 512, at which point fork() returns EAGAIN and tools die with
  // opaque "sub-process dpkg unexpectedly exited" / fork errors. Under DinD,
  // raise it to a daemon-class ceiling that still bounds a fork bomb. cpu/memory
  // stay the operator-tunable resource budget (a heavy build is slow, not
  // broken, when they're tight). Non-DinD keeps today's 512 verbatim.
  const pidsLimitValue = dind
    ? Math.max(profile.pidsLimit, 16384)
    : profile.pidsLimit;

  // Inner dockerd storage: a dedicated, ephemeral, size-bounded volume so the
  // image/layer store never lands on the overlay-backed workspace bind mount
  // (nested overlay is rejected by the kernel) and can't fill the host disk.
  let dockerStorageMount: string[] = [];
  let dindEnv: string[] = [];
  if (dind) {
    if (!inp.dockerStorageVolume) {
      throw new Error(
        'docker-session-args: dockerStorageVolume is required when dockerInContainer is enabled',
      );
    }
    assertSafe('dockerStorageVolume', inp.dockerStorageVolume, VOL_RE);
    dockerStorageMount = [
      '--mount',
      `type=volume,src=${inp.dockerStorageVolume},dst=/var/lib/docker`,
    ];
    // TALE_DIND switches the entrypoint into DinD mode; TALE_RUNTIME_TIER lets
    // it apply the sysbox-only uid_map remap assertion. The tier is a typed
    // enum constant (no injection surface).
    dindEnv = [
      '--env',
      'TALE_DIND=1',
      '--env',
      `TALE_RUNTIME_TIER=${cfg.runtimeTier}`,
    ];
    // Shared build cache: point the session at the shared buildkitd so the
    // entrypoint can wire a remote buildx builder. Only present when the backend
    // resolved an endpoint (cfg.dockerBuildCache on + the daemon came up), so
    // the off path stays argv byte-identical.
    if (inp.buildkitdEndpoint) {
      assertSafe('buildkitdEndpoint', inp.buildkitdEndpoint, ENDPOINT_RE);
      dindEnv.push('--env', `TALE_BUILDKITD_ENDPOINT=${inp.buildkitdEndpoint}`);
    }
  }

  // Live browser view (operator flag): signal the entrypoint to bring up the
  // headed-Chromium + x11vnc read-only mirror (start_browser_stack). Additive
  // and only present when enabled — off keeps today's argv byte-identical. The
  // CDP (9222) / VNC (5900) endpoints are loopback-only; no port is published.
  // Agent-only, like DinD: a run_code (`default`) session has no browser tool,
  // so the headed-Chromium stack would be pure boot latency + attack surface.
  const browserViewEnv =
    cfg.browserView && inp.profile === 'agent'
      ? ['--env', 'TALE_BROWSER_CDP=1']
      : [];

  // Transparent egress signal for the entrypoint. On the non-DinD hardening path
  // the container boots as root, so TALE_DROP_UID/GID tell the entrypoint which
  // profile uid to setpriv-drop to after installing the OUTPUT REDIRECT. On DinD
  // the entrypoint already drops to the agent uid itself, so only the signal is
  // sent. Empty when off ⇒ argv byte-identical.
  const transparentEgressEnv = transparentEgress
    ? [
        '--env',
        'TALE_TRANSPARENT_EGRESS=1',
        ...(transparentEgressHardening
          ? [
              '--env',
              `TALE_DROP_UID=${profile.uid}`,
              '--env',
              `TALE_DROP_GID=${profile.gid}`,
            ]
          : []),
      ]
    : [];

  // Per-org shared dep caches are DISABLED under DinD (sysbox userns shifting
  // makes a cross-session shared volume's ownership/integrity unsafe — a
  // same-org cache-poisoning vector). Cold caches are the safe default; installs
  // still work, just uncached across sessions. See plan D2.
  const cacheEnv = dind
    ? []
    : [
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
      ];
  const cacheMounts = dind
    ? []
    : [
        '--mount',
        `type=volume,src=${inp.pipCacheVolume},dst=/cache/pip`,
        '--mount',
        `type=volume,src=${inp.npmCacheVolume},dst=/cache/npm`,
        '--mount',
        `type=volume,src=${inp.bunCacheVolume},dst=/cache/bun`,
      ];

  const containerName = sessionContainerName(inp.sessionId);
  return [
    'run',
    '-d',
    `--runtime=${dockerRuntimeFor(cfg.runtimeTier)}`,
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
    // Session execs reach the LLM gateway (sandbox-llm-gateway) and the
    // backend origin (the in-sandbox connector bridge → /api/connectors/*,
    // the staging callback) directly on the internal bridge — not through
    // tinyproxy. The agent adapters set ANTHROPIC_BASE_URL at the gateway
    // and the bridge calls http://backend-api:3005, so both must be in
    // NO_PROXY or the CONNECT would be denied. If
    // EXTERNAL_AGENT_CONNECTORS_URL overrides the host, this list must
    // match. The retired 0.4 `convex` alias and the old `llm-gateway` alias
    // stay for one release so in-flight sessions pinned to pre-rename
    // hostnames keep resolving.
    '--env',
    `NO_PROXY=127.0.0.1,localhost,sandbox-llm-gateway,llm-gateway,backend-api,backend-relay,convex`,
    // Per-org shared dep caches (empty under DinD — see cacheEnv above).
    ...cacheEnv,
    // HOME on the persistent workspace volume so agent state (~/.claude,
    // ~/.config/opencode, ~/.gitconfig) survives every exec + restart.
    '--env',
    `HOME=/agent/.runtime/home`,
    // Per-session runnerd auth. Empty in unsigned dev mode (runnerd skips the
    // check); a real hex token otherwise.
    '--env',
    `TALE_RUNNERD_TOKEN=${inp.runnerdToken}`,
    // DinD signal + tier for the entrypoint (empty when DinD is off).
    ...dindEnv,
    // Live browser view signal for the entrypoint (empty when off).
    ...browserViewEnv,
    // Transparent egress signal + drop-uid for the entrypoint (empty when off).
    ...transparentEgressEnv,
    `--cpus=${profile.cpus}`,
    `--memory=${profile.memory}`,
    `--memory-swap=${profile.memory}`,
    `--pids-limit=${pidsLimitValue}`,
    '--log-driver=json-file',
    '--log-opt',
    'max-size=10m',
    '--log-opt',
    'max-file=1',
    ...ulimitFlags,
    '--oom-score-adj=500',
    // Read-only root unless DinD (dockerd needs a writable rootfs; its store is
    // the dedicated /var/lib/docker volume below).
    ...readOnlyFlag,
    '--tmpfs',
    `/tmp:exec,nosuid,nodev,size=${profile.tmpfsSize}`,
    // /dev/shm: Docker's 64m default crashes Chromium under Playwright.
    `--shm-size=${profile.shmSize}`,
    '--mount',
    `type=bind,src=${inp.workspaceHostDir},dst=/agent`,
    // Inner dockerd storage volume (empty when DinD is off).
    ...dockerStorageMount,
    // Hardening: cap-drop/no-new-privileges/apparmor=docker-default when !dind;
    // apparmor=unconfined when dind (the userns/VM is the real boundary).
    ...hardeningFlags,
    '--user',
    userValue,
    // Per-org cache volume mounts (empty under DinD — cold caches; see above).
    ...cacheMounts,
    cfg.runtimeImage,
    // Entrypoint dispatch: `daemon` mode boots runnerd as PID 1 instead of
    // running a one-shot script. See sandbox-runtime/entrypoint.sh.
    'daemon',
  ];
}
