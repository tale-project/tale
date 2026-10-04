// Spawner config + the harvested-output shape. (The one-shot request/response
// wire shapes moved out with the retired one-shot execution path; every sandbox
// run is a session now.)

import type { RuntimeTier } from './runtime-tier.ts';

export interface SpawnerConfig {
  // Execution backend (env SANDBOX_BACKEND). 'docker' spawns sibling
  // containers via the host docker socket (Compose, the default);
  // 'kubernetes' runs each execution as a Pod (Helm, Phase 2).
  backend: 'docker' | 'kubernetes';
  port: number;
  // The shared HMAC secret (env SANDBOX_TOKEN) every state-changing route is
  // verified against, and the key the per-session runnerd tokens derive from.
  // REQUIRED: `loadConfig()` refuses to boot when it is unset or blank — there
  // is no unsigned mode (the spawner holds the host docker socket and sits on
  // the network every session container shares).
  sandboxToken: string;
  runtimeImage: string;
  // Deployment-level container runtime tier (env SANDBOX_RUNTIME; default
  // 'runc'). Resolves to the docker `--runtime` value and the k8s
  // runtimeClassName via runtime-tier.ts. Uniform across all tenants.
  runtimeTier: RuntimeTier;
  // Native docker/docker compose inside SESSION containers (env
  // SANDBOX_DOCKER_IN_CONTAINER). Enabled by default on sysbox/kata, opt-in on
  // other tiers; runtime-tier.ts defines their different isolation guarantees.
  // Only agent-profile sessions receive this capability.
  dockerInContainer: boolean;
  /** Workloads allowed to use inner Docker. Absent preserves the historical
   * setting for all agent sessions; an empty list disables it for new ones. */
  dockerWorkloads?: readonly ('project' | 'workflow')[];
  // Operator-selected private /16 for inner Docker on either backend. Unset
  // selects automatically; the runtime also rejects observed network overlap.
  dindInnerPool?: string;
  // Shared cross-session docker build cache (env SANDBOX_DOCKER_BUILD_CACHE;
  // DEFAULT = follows dockerInContainer, i.e. on whenever DinD is on). When on,
  // the spawner lazily launches one persistent buildkitd and per-registry
  // pull-through mirrors per organization (see buildkitd.ts). Sessions use a
  // remote buildx builder on their organization's private network, so builds
  // reuse that organization's cache across sessions.
  // Inert without DinD; set false to opt out (keeps the extra daemons off).
  dockerBuildCache: boolean;
  // The shared buildkitd image ref the spawner launches (env
  // SANDBOX_BUILDKITD_IMAGE). Defaults to a dev tag; release deployments pin the
  // ghcr ref so the daemon matches the deployed version.
  buildkitdImage: string;
  // The pull-through registry mirror image (env SANDBOX_BUILDKITD_MIRROR_IMAGE;
  // default stock `registry:2`) launched alongside the buildkitd so base-image
  // pulls resolve by name on the internal net (buildkit can't resolve external
  // registry names through docker's embedded DNS).
  buildkitdMirrorImage: string;
  // The bounds of each organization's builder (env SANDBOX_BUILDKITD_CPUS and
  // SANDBOX_BUILDKITD_MEMORY): unset, an agent session's CPUs and twice its
  // memory (buildkitd.ts buildkitHelperLimits).
  buildkitdCpus?: number;
  buildkitdMemoryBytes?: number;
  /** Optional cache setup budget inside the session create deadline. */
  buildkitdStartTimeoutMs?: number;
  // The build cache an organization's builder keeps when it stops for want of
  // agent sessions (env SANDBOX_BUILDKITD_IDLE_CACHE): unset, 5 GiB
  // (buildkitd.ts DEFAULT_IDLE_CACHE_BYTES).
  buildkitdIdleCacheBytes?: number;
  // How long an organization's stopped build helpers keep their caches
  // (env SANDBOX_BUILDKITD_CACHE_RETENTION): unset, 14 days; 0 keeps them
  // until the organization is deleted (buildkitd.ts sweepIdleBuildkitd).
  buildkitdCacheRetentionMs?: number;
  // Transparent egress for the session container's OWN processes (env
  // SANDBOX_TRANSPARENT_EGRESS; default true). When true the entrypoint installs
  // an iptables OUTPUT REDIRECT → redsocks → the egress proxy, so ANY client
  // (Node/undici, Go static binaries, raw sockets) reaches the internet through
  // the proxy with zero proxy-env awareness — closing the leak where proxy-
  // ignorant clients silently fail. Requires NET_ADMIN at boot (granted to PID 1
  // root, dropped via setpriv before any user process runs). Unsupported on the
  // gvisor tier (runsc netstack) — loadConfig warns and the session falls back to
  // the HTTPS_PROXY env for proxy-aware clients only. Off ⇒ today's env-only path.
  transparentEgress: boolean;
  // Kubernetes-backend settings (env SANDBOX_K8S_*). Always populated by
  // loadConfig; consumed only when backend === 'kubernetes'.
  k8s: {
    // Namespace the session Pods / Secrets / workspace PVCs are created in.
    namespace: string;
    // RuntimeClass applied to runtime Pods, resolved per tier (gVisor →
    // 'gvisor', sysbox → 'sysbox-runc', kata → 'kata', runc → null = omit the
    // field). An operator may override the non-null value via
    // SANDBOX_RUNTIME_CLASS for clusters that name the class differently.
    runtimeClassName: string | null;
    // Size of the per-session /agent workspace PVC (K8s quantity string, env
    // SANDBOX_K8S_WORKSPACE_SIZE_LIMIT; storage class from
    // SANDBOX_K8S_CACHE_STORAGECLASS) and, under DinD, the sizeLimit of the
    // inner-docker emptyDir. Everything the session writes — dependency
    // installs, temp files, outputs — lands on the workspace, so without a
    // bound a runaway session can fill the node disk; the K8s analogue of
    // docker's fsize ulimit.
    workspaceSizeLimit: string;
    // What every session Pod requests from the scheduler, overriding the
    // per-profile defaults (env SANDBOX_K8S_CPU_REQUEST /
    // SANDBOX_K8S_MEMORY_REQUEST, K8s quantities). Never above the limit.
    cpuRequest?: string;
    memoryRequest?: string;
  };
  maxTimeoutMs: number;
  // Single flat host session root. The sandbox tier is one container that rolls
  // in-place via a serialized drain — no blue/green colour, so no per-colour
  // sub-directory. Sessions created under a previous colour-rooted build are
  // still adopted (running ones keep their live mount; stopped ones via the
  // legacy-compat resume fallback in docker-session-backend.ts).
  hostSessionRoot: string;
  /** Opt-in, verified read-only view of DockerRootDir for disk admission. */
  dockerDataPath?: string;
  dockerDataRoot?: string;
  cacheVolumePrefix: { pip: string; npm: string; bun: string };
  egressNetwork: string;
  egressProxy: string;
  stdoutMaxBytes: number;
  stderrMaxBytes: number;
  // Maximum request body size (bytes) on every spawner route (env
  // SANDBOX_MAX_REQUEST_BODY_BYTES). Defaults to, and is clamped at, runnerd's
  // RUNNERD_MAX_REQUEST_BODY_BYTES (8 MiB): the session file endpoints forward
  // their inline stage content to the daemon verbatim, so a body accepted here
  // must never be refused there as oversize.
  maxRequestBodyBytes: number;
  // The spawner instance (env SANDBOX_INSTANCE; empty = the deployment's
  // spawner). Every session this spawner starts carries it as a label, and
  // every inventory it acts on is scoped to it, so a connected device and a
  // deployment sharing one Docker daemon never touch each other's sessions.
  instance: string;
  // The device hub (env SANDBOX_HUB_PORT > 0, Docker backend only): the
  // WebSocket door connected devices dial, and where their sessions'
  // relayed calls go. Null when off.
  hub: HubConfig | null;
  // Device mode (env SANDBOX_DEVICE_CONFIG): this spawner runs on a machine
  // an organization connected and dials the hub instead of being called by
  // the platform directly. The path of the device's config file.
  deviceConfigPath: string | null;
  // Persistent-session knobs (sessions plan; env SANDBOX_SESSION_* /
  // SANDBOX_MAX_SESSIONS*). Always populated by loadConfig; consumed by the
  // session routes + session backends only — the one-shot /v1/execute path
  // never reads these.
  session: SessionConfig;
}

export interface HubConfig {
  /** Port of the WebSocket door (published by the proxy at /sandbox/tunnel). */
  port: number;
  /** Persistent directory for the placement file. */
  stateDir: string;
  /** The real services behind a device's relays, as the hub reaches them. */
  relays: { api: string; gateway: string };
}

export interface SessionConfig {
  /** Spawner-wide concurrent session cap (replica-local on Docker). */
  maxSessions: number;
  /** No SANDBOX_MAX_SESSIONS was set: a Docker spawner that can read its
   * host's memory sizes {@link maxSessions} from it at boot. */
  autoMaxSessions?: boolean;
  /** Memory admission always leaves free on the host (SANDBOX_MIN_FREE_MEMORY);
   * unset is a tenth of the host, at least 1 GiB. */
  minFreeMemoryBytes?: number;
  /** Free space admission keeps on the disk the workspaces live on
   * (SANDBOX_MIN_FREE_DISK; 0 turns the floor off); unset is a twentieth of
   * the disk, at least 2 GiB and at most 20 GiB (host-disk.ts). */
  minFreeDiskBytes?: number;
  /** Hard wall-clock ceiling on a session's lifetime. */
  maxLifetimeMs: number;
  /** Idle ceiling — sessions with no runnerd activity past this are reaped. */
  maxIdleMs: number;
  /** Idle window for a session the platform has RELEASED (its turn or run
   * settled, nothing holds it): stopped once idle this long instead of after
   * the full {@link maxIdleMs}. Docker-in-sandbox sessions keep the full
   * window, since their resume rebuilds an empty inner image store. */
  releasedIdleMs: number;
  /** Max time the spawner will LINGER (keep serving its sessions) after a deploy
   * put it into drain mode before it reclaims that compute itself
   * (CLI-independent safety net). Workspaces are preserved for resume. See
   * server.ts's linger self-reap. */
  maxLingerMs: number;
  /** Default + ceiling for per-exec timeoutMs inside a session. */
  execDefaultTimeoutMs: number;
  execMaxTimeoutMs: number;
  /** Create-time budget for container launch + runnerd /healthz to go green
   * (covers a cold image pull on K8s). */
  createHealthTimeoutMs: number;
  /** Resource caps for the `agent` profile session containers. The `default`
   * profile mirrors the one-shot caps and is not configurable separately. */
  agentProfile: SessionAgentProfileConfig;
}

export interface SessionAgentProfileConfig {
  cpus: number;
  /** Docker quantity string, e.g. '4g' (memory-swap is pinned to the same
   * value — no swap headroom, matching the one-shot containers). */
  memory: string;
  /** Derived non-Docker ceiling; an explicit SANDBOX_AGENT_MEMORY sets both. */
  memoryWithoutDocker?: string;
  pidsLimit: number;
  nofileSoft: number;
  nofileHard: number;
  /** Per-file size ulimit in bytes. */
  fsizeBytes: number;
  /** tmpfs /tmp size (docker quantity string). */
  tmpfsSize: string;
  /** /dev/shm size — Docker's 64m default crashes Chromium (Playwright). */
  shmSize: string;
  /** uid:gid the agent-profile container runs as (the image's `agent` user;
   * non-root is load-bearing — Claude Code refuses bypassPermissions as
   * root). Validated at config load (uid/gid integers >= 1). */
  user: string;
  /** Parsed `user` uid, validated >= 1 at config load. */
  uid: number;
  /** Parsed `user` gid, validated >= 1 at config load. */
  gid: number;
}
