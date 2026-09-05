// Spawner configuration — parsed from env at boot. Defaults match the plan;
// every knob is overridable so an operator can tune without rebuilding.

import { readFileSync } from 'node:fs';

import { parse as parseYaml } from 'yaml';

import {
  dindDefaultEnabled,
  dindExperimental,
  dindIsPrivileged,
  isRuntimeTier,
  k8sRuntimeClassFor,
  RUNTIME_TIERS,
  transparentEgressSupported,
  type RuntimeTier,
} from './runtime-tier.ts';
import { RUNNERD_MAX_REQUEST_BODY_BYTES } from './session/runnerd-protocol.ts';
import type { SpawnerConfig } from './types.ts';

// Parse a boolean env, returning undefined when UNSET/empty so a caller can
// distinguish "operator didn't set it" (apply a default) from an explicit
// true/false. 'true'/'1'/'yes'/'on' ⇒ true; everything else ⇒ false. Trimmed
// so '  true  ' works. Used for SANDBOX_DOCKER_IN_CONTAINER (tier-aware default).
function boolEnvOpt(name: string): boolean | undefined {
  const v = process.env[name]?.trim().toLowerCase();
  if (v === undefined || v === '') return undefined;
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}

/**
 * The `sandboxRuntime` section of the deployment config, if present. The
 * spawner mounts the shared platform-config dir read-only (see compose.yml);
 * the deployment config is the operator's higher-level source of truth and OVERRIDES
 * the SANDBOX_RUNTIME / SANDBOX_DOCKER_IN_CONTAINER env when it sets them.
 * Reads `deployment.yml` (the current form) with the retired
 * `deployment.json` as a fallback until the platform's next save converts
 * it. Absent files ⇒ env defaults (the common case). Present-but-unparseable
 * ⇒ fail closed (matches the rag/convex boot convention), since silently
 * ignoring a config the operator wrote reads as a misconfiguration.
 */
function deploymentSandboxRuntime(): {
  tier?: string;
  dockerInContainer?: boolean;
  dockerBuildCache?: boolean;
} {
  const dir =
    process.env.TALE_PLATFORM_SHARED_CONFIG_DIR ?? '/app/platform-config';
  const candidates = [`${dir}/deployment.yml`, `${dir}/deployment.json`];
  let raw: string | undefined;
  let path = candidates[0];
  for (const candidate of candidates) {
    try {
      raw = readFileSync(candidate, 'utf8');
      path = candidate;
      break;
    } catch (err) {
      // ENOENT (no deployment config in this form) → try the next form.
      if (
        err !== null &&
        typeof err === 'object' &&
        'code' in err &&
        err.code === 'ENOENT'
      ) {
        continue;
      }
      throw new Error(`could not read ${candidate}`, { cause: err });
    }
  }
  if (raw === undefined) return {};
  let json: {
    sandboxRuntime?: {
      tier?: unknown;
      dockerInContainer?: unknown;
      dockerBuildCache?: unknown;
    };
  };
  try {
    // YAML is a superset of JSON, so one parser covers both era forms.
    json = parseYaml(raw);
  } catch (err) {
    throw new Error(
      `${path} is present but not valid YAML/JSON (fail-closed)`,
      { cause: err },
    );
  }
  const sr = json.sandboxRuntime;
  if (!sr || typeof sr !== 'object') return {};
  const out: {
    tier?: string;
    dockerInContainer?: boolean;
    dockerBuildCache?: boolean;
  } = {};
  if (typeof sr.tier === 'string') out.tier = sr.tier;
  if (typeof sr.dockerInContainer === 'boolean') {
    out.dockerInContainer = sr.dockerInContainer;
  }
  if (typeof sr.dockerBuildCache === 'boolean') {
    out.dockerBuildCache = sr.dockerBuildCache;
  }
  return out;
}

function numEnv(
  name: string,
  fallback: number,
  opts?: { min?: number; max?: number },
): number {
  const v = process.env[name];
  // Trim + empty-string ⇒ unset. Without the trim, `SANDBOX_PORT='  '` would
  // pass `Number('  ') === 0` and silently disable the port (audit finding).
  if (v === undefined || v.trim() === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new Error(
      `Env var ${name} is not a finite number: ${JSON.stringify(v)}`,
    );
  }
  const min = opts?.min ?? 0;
  if (n < min) {
    throw new Error(`Env var ${name} must be >= ${min}; got: ${n}`);
  }
  if (opts?.max !== undefined && n > opts.max) {
    throw new Error(`Env var ${name} must be <= ${opts.max}; got: ${n}`);
  }
  return n;
}

/**
 * Parse + validate a `uid:gid` env (SANDBOX_AGENT_USER). Both must be integers
 * >= 1 — a malformed value (`"invalid"` ⇒ NaN, `":"` ⇒ 0:0 = root) would
 * otherwise silently land the agent container on root, defeating the non-root
 * hardening that Claude Code's bypassPermissions depends on. Returns the
 * canonical `uid:gid` string plus the parsed numerics for backends that need
 * either form.
 */
function userEnv(
  name: string,
  fallback: string,
): { user: string; uid: number; gid: number } {
  const raw = process.env[name];
  const value = raw === undefined || raw.trim() === '' ? fallback : raw.trim();
  if (!/^\d+:\d+$/.test(value)) {
    throw new Error(
      `Env var ${name} must be 'uid:gid' (digits only); got: ${JSON.stringify(value)}`,
    );
  }
  const [uidStr, gidStr] = value.split(':');
  const uid = Number(uidStr);
  const gid = Number(gidStr);
  if (uid < 1 || gid < 1) {
    throw new Error(
      `Env var ${name} must have uid >= 1 and gid >= 1 (no root); got: ${value}`,
    );
  }
  return { user: `${uid}:${gid}`, uid, gid };
}

export function loadConfig(): SpawnerConfig {
  // Runtime tier (default 'runc'). The deployment config (deployment.json,
  // operator's higher-level source of truth) overrides SANDBOX_RUNTIME when set;
  // 'runsc' is accepted as a back-compat alias for the 'gvisor' tier. The tier
  // is the deployment-wide, uniform isolation choice; it resolves to the docker
  // --runtime value and k8s runtimeClassName via runtime-tier.ts.
  const deployment = deploymentSandboxRuntime();
  const rawRuntime = (
    deployment.tier ??
    process.env.SANDBOX_RUNTIME ??
    'runc'
  ).trim();
  const aliased = rawRuntime === 'runsc' ? 'gvisor' : rawRuntime;
  if (!isRuntimeTier(aliased)) {
    throw new Error(
      `SANDBOX_RUNTIME must be one of ${RUNTIME_TIERS.join(', ')} (or 'runsc' for gvisor); got: ${JSON.stringify(rawRuntime)}`,
    );
  }
  const runtimeTier: RuntimeTier = aliased;
  // Native docker-in-container inside session containers. NOT policy-blocked on
  // any tier — the operator chooses the host posture; we surface the trade-offs
  // as loud warnings. Resolution precedence: deployment.json > explicit env >
  // tier-aware default. The default is ON for boundary-keeping tiers (sysbox
  // userns / kata VM — docker "just works" once the runtime is set up) and OFF
  // for runc (privileged host-root — opt-in only) and gvisor (flaky).
  //   runc  → PRIVILEGED inner daemon, no boundary (host-root): trusted-only.
  //   gvisor→ contained by runsc but nested docker networking is unreliable.
  //   sysbox/kata → the recommended, isolated paths.
  const dockerInContainer =
    deployment.dockerInContainer ??
    boolEnvOpt('SANDBOX_DOCKER_IN_CONTAINER') ??
    dindDefaultEnabled(runtimeTier);
  if (dockerInContainer) {
    if (dindIsPrivileged(runtimeTier)) {
      console.warn(
        `[sandbox.config] WARNING: docker-in-container on the '${runtimeTier}' tier runs a ` +
          `PRIVILEGED inner daemon with NO isolation boundary — in-container root IS host root. ` +
          `Use this ONLY for fully-trusted / single-tenant deployments. For untrusted multi-tenant, ` +
          `set SANDBOX_RUNTIME=sysbox (or kata) so in-container root maps to an unprivileged host uid.`,
      );
    } else if (dindExperimental(runtimeTier)) {
      console.warn(
        `[sandbox.config] WARNING: docker-in-container on the '${runtimeTier}' tier is EXPERIMENTAL — ` +
          `gVisor's user-space netstack + partial iptables commonly break nested-container networking ` +
          `(inner bridge/DNS/port publishing and the in-pod egress fence). Security is fine (runsc ` +
          `contains it); functionality is not guaranteed. Use SANDBOX_RUNTIME=sysbox (or kata) for reliable DinD.`,
      );
    }
  }
  // Shared build cache: a single, persistent buildkitd + pull-through registry
  // mirror (the spawner launches them lazily, see buildkitd.ts) that every
  // session's `docker build` / `docker compose up --build` reuses across sessions
  // — instead of each session rebuilding all layers in its ephemeral inner
  // /var/lib/docker. DEFAULT = FOLLOW DinD: it's only meaningful with DinD (the
  // inner docker is what builds), and when DinD is on it's a strict, best-effort
  // improvement (a failed daemon falls back to the inner builder), so there's no
  // reason to make the operator opt in twice. Explicit SANDBOX_DOCKER_BUILD_CACHE
  // (or deployment.json) always wins — set it false to keep the extra daemons off.
  const dockerBuildCache =
    deployment.dockerBuildCache ??
    boolEnvOpt('SANDBOX_DOCKER_BUILD_CACHE') ??
    dockerInContainer;
  if (dockerBuildCache && !dockerInContainer) {
    console.warn(
      `[sandbox.config] WARNING: SANDBOX_DOCKER_BUILD_CACHE is on but docker-in-container is OFF — ` +
        `the shared build cache is inert without DinD (there is no inner docker to build). ` +
        `Enable SANDBOX_DOCKER_IN_CONTAINER (or a sysbox/kata tier) to use it.`,
    );
  }
  // Transparent egress for the session container's own processes (default ON).
  // The entrypoint installs an iptables OUTPUT REDIRECT → redsocks so any client
  // egresses through the proxy without honoring HTTP(S)_PROXY env. Reliable on
  // runc/sysbox/kata; unsupported on gvisor (runsc netstack) — warn and let the
  // session fall back to env-proxy for proxy-aware clients only.
  const transparentEgress = boolEnvOpt('SANDBOX_TRANSPARENT_EGRESS') ?? true;
  if (transparentEgress && !transparentEgressSupported(runtimeTier)) {
    console.warn(
      `[sandbox.config] WARNING: transparent egress is not supported on the '${runtimeTier}' tier ` +
        `(runsc's user-space netstack makes the iptables OUTPUT REDIRECT unreliable). Sessions fall ` +
        `back to the HTTPS_PROXY env, so proxy-IGNORANT clients (Node/undici default fetch, Go static ` +
        `binaries) will fail to reach the internet. Use SANDBOX_RUNTIME=runc (or sysbox/kata) for ` +
        `transparent egress, or set SANDBOX_TRANSPARENT_EGRESS=false to silence this.`,
    );
  }

  // The sandbox tier is a SINGLE container that rolls in-place via a serialized
  // drain — there is no blue/green colour here (the platform tier keeps it).
  // The session root is therefore the single flat path; sessions created by a
  // previous (colour-rooted) build are still adoptable, see the legacy-compat
  // fallback in docker-session-backend.ts.
  const sessionRootBase =
    process.env.SANDBOX_HOST_SESSION_ROOT ?? '/var/lib/tale-sandbox/sessions';

  const rawBackend = process.env.SANDBOX_BACKEND ?? 'docker';
  if (rawBackend !== 'docker' && rawBackend !== 'kubernetes') {
    throw new Error(
      `SANDBOX_BACKEND must be 'docker' or 'kubernetes'; got: ${JSON.stringify(rawBackend)}`,
    );
  }
  const backend: 'docker' | 'kubernetes' = rawBackend;
  // SANDBOX_TOKEN is REQUIRED — fail closed. The spawner holds the host docker
  // socket and is reachable from every session container on the shared sandbox
  // network, so it must never boot with HMAC verification off; an unset secret
  // is a hard failure, not a bypass. Trimmed so a whitespace-only value is
  // treated as unset (otherwise it would enable HMAC with a trivially weak
  // space key) — consistent with numEnv/userEnv above and the client side
  // (session_client / screencast-relay also trim).
  const sandboxToken = process.env.SANDBOX_TOKEN?.trim() ?? '';
  if (sandboxToken.length === 0) {
    throw new Error(
      'SANDBOX_TOKEN is required: the sandbox spawner refuses to start without the shared HMAC ' +
        'secret (it holds the host docker socket and is reachable from every session container). ' +
        '`tale deploy` and `bun run dev` mint it into .env; for a hand-rolled compose stack set ' +
        'SANDBOX_TOKEN=$(openssl rand -hex 32) in .env (compose.dev.yml carries an insecure dev default).',
    );
  }

  // Cross-backend env combos are accepted (so a single env file can serve
  // both deployment shapes) but warn — a silently-ignored knob reads like a
  // misconfiguration to the operator who set it.
  const K8S_ONLY_ENVS = [
    'SANDBOX_K8S_NAMESPACE',
    'SANDBOX_K8S_WORKSPACE_SIZE_LIMIT',
    'SANDBOX_K8S_CACHE_STORAGECLASS',
    'SANDBOX_K8S_SERVER',
    'SANDBOX_K8S_TOKEN',
    'SANDBOX_K8S_CAFILE',
  ];
  // (The cache-volume prefixes are NOT docker-only — k8s reuses them as PVC
  // name prefixes.)
  const DOCKER_ONLY_ENVS = [
    'SANDBOX_HOST_SESSION_ROOT',
    'SANDBOX_EGRESS_NETWORK',
  ];
  const inert =
    backend === 'docker'
      ? K8S_ONLY_ENVS
      : backend === 'kubernetes'
        ? DOCKER_ONLY_ENVS
        : [];
  for (const name of inert) {
    const v = process.env[name];
    if (v !== undefined && v.trim() !== '') {
      console.warn(
        `[sandbox.config] ${name} is set but has no effect with SANDBOX_BACKEND=${backend}`,
      );
    }
  }
  // Body cap on every spawner route. /v1/sessions/:id/files/stage takes
  // INLINE base64 content (bound org skills, useSkills subtrees, steer control
  // files), so the cap must fit a real skill-bundle chunk plus JSON envelope;
  // the platform client chunks its stage payloads well under it
  // (session_client.ts STAGE_BODY_BUDGET_BYTES). The same `files` array is
  // forwarded verbatim to runnerd, which caps its bodies at
  // RUNNERD_MAX_REQUEST_BODY_BYTES — so the spawner's cap is CLAMPED to that:
  // a body the spawner accepts can never be refused by the daemon as oversize.
  // Operators can lower it via SANDBOX_MAX_REQUEST_BODY_BYTES; raising it past
  // the daemon's cap is a no-op that warns.
  const requestedMaxRequestBodyBytes = numEnv(
    'SANDBOX_MAX_REQUEST_BODY_BYTES',
    RUNNERD_MAX_REQUEST_BODY_BYTES,
    { min: 4 * 1024 },
  );
  const maxRequestBodyBytes = Math.min(
    requestedMaxRequestBodyBytes,
    RUNNERD_MAX_REQUEST_BODY_BYTES,
  );
  if (maxRequestBodyBytes !== requestedMaxRequestBodyBytes) {
    console.warn(
      `[sandbox.config] SANDBOX_MAX_REQUEST_BODY_BYTES=${requestedMaxRequestBodyBytes} exceeds runnerd's request cap; clamped to ${RUNNERD_MAX_REQUEST_BODY_BYTES}`,
    );
  }

  return {
    backend,
    k8s: {
      namespace: process.env.SANDBOX_K8S_NAMESPACE ?? 'tale-sandbox',
      // Resolved per tier (runc → null = omit). For tiers that DO carry a class,
      // SANDBOX_RUNTIME_CLASS overrides the default name (clusters that register
      // e.g. 'kata-qemu' instead of 'kata'). It can never conjure a class for
      // runc (null stays null), keeping runc pods runtimeClass-free.
      runtimeClassName:
        k8sRuntimeClassFor(runtimeTier) === null
          ? null
          : (process.env.SANDBOX_RUNTIME_CLASS ??
            k8sRuntimeClassFor(runtimeTier)),
      workspaceSizeLimit: process.env.SANDBOX_K8S_WORKSPACE_SIZE_LIMIT ?? '4Gi',
    },
    port: numEnv('SANDBOX_PORT', 8003, { min: 1, max: 65535 }),
    // The shared HMAC secret every state-changing route is verified against
    // (request-auth.ts). Always set — validated above.
    sandboxToken,
    runtimeImage:
      process.env.SANDBOX_RUNTIME_IMAGE ?? 'tale-sandbox-runtime:latest',
    runtimeTier,
    dockerInContainer,
    // Shared cross-session docker build cache (default off; only meaningful with
    // DinD — resolved + warned above). When on, the spawner launches a shared
    // buildkitd and points each session's remote buildx builder at it.
    dockerBuildCache,
    // The shared buildkitd image the spawner launches (buildkitd.ts). Defaults
    // to a dev tag; release deployments set SANDBOX_BUILDKITD_IMAGE to the
    // pinned ghcr ref so the daemon matches the deployed version.
    buildkitdImage:
      process.env.SANDBOX_BUILDKITD_IMAGE ?? 'tale-sandbox-buildkitd:latest',
    // The pull-through registry mirror image (stock `registry:2`) the spawner
    // launches alongside the buildkitd so base-image pulls resolve by name on
    // the internal net. Overridable for a pinned/mirrored ref in fenced deploys.
    buildkitdMirrorImage:
      process.env.SANDBOX_BUILDKITD_MIRROR_IMAGE ?? 'registry:2',
    // Live browser view (default on; opt out with SANDBOX_BROWSER_VIEW=0). When
    // on, session containers launch with TALE_BROWSER_CDP=1 (the entrypoint's
    // headed-Chromium + x11vnc mirror). The PLATFORM reads the SAME env so the
    // adapter attaches Playwright MCP over CDP — one deployment-level decision
    // drives both sides, and they agree when the operator sets nothing.
    browserView: boolEnvOpt('SANDBOX_BROWSER_VIEW') ?? true,
    // Transparent egress for the session's own processes (default on; resolved +
    // gvisor-warned above). Off ⇒ env-proxy-only (today's behavior).
    transparentEgress,
    maxTimeoutMs: numEnv('SANDBOX_MAX_TIMEOUT_MS', 300_000, { min: 1 }),
    // Single flat session root — the sandbox tier no longer has a blue/green
    // colour, so there is no per-colour sub-directory to scope.
    hostSessionRoot: sessionRootBase,
    cacheVolumePrefix: {
      pip:
        process.env.SANDBOX_PIP_CACHE_VOLUME_PREFIX ?? 'tale-sandbox-pip-cache',
      npm:
        process.env.SANDBOX_NPM_CACHE_VOLUME_PREFIX ?? 'tale-sandbox-npm-cache',
      bun:
        process.env.SANDBOX_BUN_CACHE_VOLUME_PREFIX ?? 'tale-sandbox-bun-cache',
    },
    egressNetwork: process.env.SANDBOX_EGRESS_NETWORK ?? 'tale-sandbox-net',
    egressProxy:
      process.env.SANDBOX_EGRESS_PROXY ?? 'http://sandbox-egress:3128',
    stdoutMaxBytes: numEnv('SANDBOX_STDOUT_MAX_BYTES', 5 * 1024 * 1024, {
      min: 1024,
    }),
    stderrMaxBytes: numEnv('SANDBOX_STDERR_MAX_BYTES', 5 * 1024 * 1024, {
      min: 1024,
    }),
    maxRequestBodyBytes,
    session: {
      // GLOBAL host-capacity ceiling: the max sandbox session containers this
      // host runs at once, across all orgs (each ≈ 2 cpu / 4 g). This is the
      // single physical cap — every sandbox is a session now. The per-org
      // governance budgets (user / thread / workflow, in `sandbox_quota`) are
      // fairness slices UNDER this ceiling, so the default is sized to cover one
      // active org's summed budgets (2 + 8 + 4 = 14) with headroom. Sessions
      // idle-stop, so this is a ceiling, not a reservation — operators on a small
      // box lower SANDBOX_MAX_SESSIONS; on a big host, raise it.
      maxSessions: numEnv('SANDBOX_MAX_SESSIONS', 16, { min: 1 }),
      maxSessionsPerOrg: numEnv('SANDBOX_MAX_SESSIONS_PER_ORG', 50, { min: 1 }),
      maxLifetimeMs: numEnv(
        'SANDBOX_SESSION_MAX_LIFETIME_MS',
        24 * 60 * 60 * 1000,
        { min: 60_000 },
      ),
      maxIdleMs: numEnv('SANDBOX_SESSION_MAX_IDLE_MS', 30 * 60 * 1000, {
        min: 60_000,
      }),
      // How long a drained (lingering) spawner keeps serving its sessions after
      // a deploy before reclaiming their compute itself. 30 min covers a typical
      // long agent turn; the deploy CLI normally tears the spawner down sooner
      // once its sessions end. Min 1 min so it can't thrash.
      maxLingerMs: numEnv('SANDBOX_SESSION_MAX_LINGER_MS', 30 * 60 * 1000, {
        min: 60_000,
      }),
      execDefaultTimeoutMs: numEnv(
        'SANDBOX_SESSION_EXEC_DEFAULT_TIMEOUT_MS',
        10 * 60 * 1000,
        { min: 1_000 },
      ),
      // Per-exec hard ceiling. Raised from 2h to 24h so a long agent task isn't
      // SIGKILLed mid-run by runnerd; a single task is bounded by budget /
      // completion / manual stop, not a wall clock. Env-tunable higher.
      execMaxTimeoutMs: numEnv(
        'SANDBOX_SESSION_EXEC_MAX_TIMEOUT_MS',
        24 * 60 * 60 * 1000,
        { min: 1_000 },
      ),
      createHealthTimeoutMs: numEnv(
        'SANDBOX_SESSION_CREATE_TIMEOUT_MS',
        180_000,
        { min: 5_000 },
      ),
      agentProfile: {
        cpus: numEnv('SANDBOX_AGENT_CPUS', 2, { min: 1 }),
        // Memory is a real resource budget (the session cgroup is shared by the
        // agent and, under DinD, the inner dockerd + every nested build/run).
        // Unlike the pids/fsize *guards* (lifted unconditionally under DinD),
        // this is a deliberate allocation — but 4g is too low to host a real
        // `docker compose up --build`: a heavy frontend bundle (e.g. vite) is
        // OOM-killed mid-build (exit 137). `--memory` is a ceiling, not a
        // reservation (idle sessions don't consume it), so DinD gets a larger
        // default headroom while staying operator-tunable — an explicit
        // SANDBOX_AGENT_MEMORY always wins, and the operator sizes host RAM for
        // the concurrent-session peak.
        memory:
          process.env.SANDBOX_AGENT_MEMORY ?? (dockerInContainer ? '8g' : '4g'),
        pidsLimit: numEnv('SANDBOX_AGENT_PIDS', 512, { min: 64 }),
        nofileSoft: numEnv('SANDBOX_AGENT_NOFILE_SOFT', 4096, { min: 256 }),
        nofileHard: numEnv('SANDBOX_AGENT_NOFILE_HARD', 8192, { min: 256 }),
        fsizeBytes: numEnv('SANDBOX_AGENT_FSIZE_BYTES', 512 * 1024 * 1024, {
          min: 1024 * 1024,
        }),
        tmpfsSize: process.env.SANDBOX_AGENT_TMP_SIZE ?? '512m',
        shmSize: process.env.SANDBOX_AGENT_SHM_SIZE ?? '512m',
        // The image's `agent` user (uid 10001). Overridable only for
        // emergency rollback to nobody — Claude Code's bypassPermissions
        // requires non-root either way. Validated to a real uid:gid >= 1 so a
        // malformed override can't silently drop the container onto root.
        ...userEnv('SANDBOX_AGENT_USER', '10001:10001'),
      },
    },
  };
}
