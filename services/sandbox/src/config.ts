// Spawner configuration — parsed from env at boot. Defaults match the plan;
// every knob is overridable so an operator can tune without rebuilding.

import type { SpawnerConfig } from './types.ts';

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

export function loadConfig(): SpawnerConfig {
  const rawRuntime = process.env.SANDBOX_RUNTIME ?? 'runc';
  if (rawRuntime !== 'runc' && rawRuntime !== 'runsc') {
    throw new Error(
      `SANDBOX_RUNTIME must be 'runc' or 'runsc'; got: ${JSON.stringify(rawRuntime)}`,
    );
  }
  const runtime: 'runc' | 'runsc' = rawRuntime;
  const rawBackend = process.env.SANDBOX_BACKEND ?? 'docker';
  if (rawBackend !== 'docker' && rawBackend !== 'kubernetes') {
    throw new Error(
      `SANDBOX_BACKEND must be 'docker' or 'kubernetes'; got: ${JSON.stringify(rawBackend)}`,
    );
  }
  const backend: 'docker' | 'kubernetes' = rawBackend;
  const rawCacheMode = process.env.SANDBOX_CACHE ?? 'none';
  if (rawCacheMode !== 'none' && rawCacheMode !== 'pvc') {
    throw new Error(
      `SANDBOX_CACHE must be 'none' or 'pvc'; got: ${JSON.stringify(rawCacheMode)}`,
    );
  }
  const cacheMode: 'none' | 'pvc' = rawCacheMode;
  const rawToken = process.env.SANDBOX_TOKEN;

  // Cross-backend env combos are accepted (so a single env file can serve
  // both deployment shapes) but warn — a silently-ignored knob reads like a
  // misconfiguration to the operator who set it.
  const K8S_ONLY_ENVS = [
    'SANDBOX_K8S_NAMESPACE',
    'SANDBOX_SPAWNER_IMAGE',
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
  if (backend === 'docker' && cacheMode === 'pvc') {
    console.warn(
      '[sandbox.config] SANDBOX_CACHE=pvc has no effect with SANDBOX_BACKEND=docker (docker always uses named volumes)',
    );
  }

  return {
    backend,
    k8s: {
      namespace: process.env.SANDBOX_K8S_NAMESPACE ?? 'tale-sandbox',
      runtimeClassName: process.env.SANDBOX_RUNTIME_CLASS ?? 'gvisor',
      spawnerImage: process.env.SANDBOX_SPAWNER_IMAGE ?? 'tale-sandbox:latest',
      cacheMode,
      workspaceSizeLimit: process.env.SANDBOX_K8S_WORKSPACE_SIZE_LIMIT ?? '4Gi',
    },
    port: numEnv('SANDBOX_PORT', 8003, { min: 1, max: 65535 }),
    // Token policy: opt-in verification. Unset (or empty-string) = HMAC
    // disabled; set = enforced. `authorize()` returns null when this is
    // null, so the wire path simply skips signature checks.
    sandboxToken: rawToken && rawToken.length > 0 ? rawToken : null,
    runtimeImage:
      process.env.SANDBOX_RUNTIME_IMAGE ?? 'tale-sandbox-runtime:latest',
    runtime,
    defaultTimeoutMs: numEnv('SANDBOX_DEFAULT_TIMEOUT_MS', 30_000, { min: 1 }),
    maxTimeoutMs: numEnv('SANDBOX_MAX_TIMEOUT_MS', 300_000, { min: 1 }),
    maxConcurrent: numEnv('SANDBOX_MAX_CONCURRENT', 4, { min: 1 }),
    hostSessionRoot:
      process.env.SANDBOX_HOST_SESSION_ROOT ?? '/var/lib/tale-sandbox/sessions',
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
    outputFileMaxBytes: numEnv(
      'SANDBOX_OUTPUT_FILE_MAX_BYTES',
      50 * 1024 * 1024,
      { min: 1024 },
    ),
    outputTotalMaxBytes: numEnv(
      'SANDBOX_OUTPUT_TOTAL_MAX_BYTES',
      100 * 1024 * 1024,
      { min: 1024 },
    ),
    // Body cap on /v1/execute. The request body now carries only URL
    // lists (workspace files, prior outputs, upload slots) — no inline
    // content — so 2 MB is plenty for the JSON envelope + URL strings
    // even at the MAX_FILES_PER_REQUEST (50) ceiling. Bounds the
    // unsigned-mode OOM surface. Operators with a niche need can raise
    // via SANDBOX_MAX_REQUEST_BODY_BYTES.
    maxRequestBodyBytes: numEnv(
      'SANDBOX_MAX_REQUEST_BODY_BYTES',
      2 * 1024 * 1024,
      { min: 4 * 1024 },
    ),
    session: {
      // Spawner-wide cap = the host-RAM guard (each agent session ≈ 2 cpu / 4 g);
      // operators size it to the box. Sessions are per-USER now, so the per-org
      // cap should NOT bind before the host cap — keep it high (effectively
      // "one sandbox per active user, host RAM is the real limit").
      maxSessions: numEnv('SANDBOX_MAX_SESSIONS', 10, { min: 1 }),
      maxSessionsPerOrg: numEnv('SANDBOX_MAX_SESSIONS_PER_ORG', 50, { min: 1 }),
      maxLifetimeMs: numEnv(
        'SANDBOX_SESSION_MAX_LIFETIME_MS',
        24 * 60 * 60 * 1000,
        { min: 60_000 },
      ),
      maxIdleMs: numEnv('SANDBOX_SESSION_MAX_IDLE_MS', 30 * 60 * 1000, {
        min: 60_000,
      }),
      execDefaultTimeoutMs: numEnv(
        'SANDBOX_SESSION_EXEC_DEFAULT_TIMEOUT_MS',
        10 * 60 * 1000,
        { min: 1_000 },
      ),
      execMaxTimeoutMs: numEnv(
        'SANDBOX_SESSION_EXEC_MAX_TIMEOUT_MS',
        2 * 60 * 60 * 1000,
        { min: 1_000 },
      ),
      createHealthTimeoutMs: numEnv(
        'SANDBOX_SESSION_CREATE_TIMEOUT_MS',
        180_000,
        { min: 5_000 },
      ),
      agentProfile: {
        cpus: numEnv('SANDBOX_AGENT_CPUS', 2, { min: 1 }),
        memory: process.env.SANDBOX_AGENT_MEMORY ?? '4g',
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
        // requires non-root either way.
        user: process.env.SANDBOX_AGENT_USER ?? '10001:10001',
      },
    },
  };
}
