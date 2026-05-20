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

function boolEnv(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  const lower = v.trim().toLowerCase();
  if (lower === '') return fallback;
  if (lower === 'true' || lower === '1' || lower === 'yes') return true;
  if (lower === 'false' || lower === '0' || lower === 'no') return false;
  throw new Error(
    `Env var ${name} must be a boolean; got: ${JSON.stringify(v)}`,
  );
}

export function loadConfig(): SpawnerConfig {
  const rawRuntime = process.env.SANDBOX_RUNTIME ?? 'runc';
  if (rawRuntime !== 'runc' && rawRuntime !== 'runsc') {
    throw new Error(
      `SANDBOX_RUNTIME must be 'runc' or 'runsc'; got: ${JSON.stringify(rawRuntime)}`,
    );
  }
  const runtime: 'runc' | 'runsc' = rawRuntime;
  const rawToken = process.env.SANDBOX_TOKEN;
  return {
    port: numEnv('SANDBOX_PORT', 8003, { min: 1, max: 65535 }),
    // Empty string treated as unset so `SANDBOX_TOKEN=` in .env behaves
    // the same as not declaring it at all. The fail-closed check at server
    // boot rejects an unset token unless `SANDBOX_ALLOW_UNAUTH=true`.
    sandboxToken: rawToken && rawToken.length > 0 ? rawToken : null,
    // Dev-only opt-in: rag/crawler-parity for `bun dev`. Production always
    // requires a token; deploy.ts auto-mints one via ensure-env.
    allowUnauth: boolEnv('SANDBOX_ALLOW_UNAUTH', false),
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
    // Body cap on /v1/execute. Even the unsigned dev mode shouldn't be
    // OOM-able by a single oversized POST. 256 KB easily covers any
    // realistic agent-authored code + small input file set.
    maxRequestBodyBytes: numEnv('SANDBOX_MAX_REQUEST_BODY_BYTES', 256 * 1024, {
      min: 4 * 1024,
    }),
  };
}
