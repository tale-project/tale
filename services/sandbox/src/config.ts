// Spawner configuration — parsed from env at boot. Defaults match the plan;
// every knob is overridable so an operator can tune without rebuilding.

import type { SpawnerConfig } from './types.ts';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function numEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new Error(`Env var ${name} is not a finite number: ${v}`);
  }
  return n;
}

export function loadConfig(): SpawnerConfig {
  const runtime = (process.env.SANDBOX_RUNTIME ?? 'runc') as 'runc' | 'runsc';
  if (runtime !== 'runc' && runtime !== 'runsc') {
    throw new Error(
      `SANDBOX_RUNTIME must be 'runc' or 'runsc'; got: ${runtime}`,
    );
  }
  return {
    port: numEnv('SANDBOX_PORT', 8003),
    sandboxToken: requireEnv('SANDBOX_TOKEN'),
    runtimeImage:
      process.env.SANDBOX_RUNTIME_IMAGE ?? 'tale-sandbox-runtime:latest',
    runtime,
    defaultTimeoutMs: numEnv('SANDBOX_DEFAULT_TIMEOUT_MS', 30_000),
    maxTimeoutMs: numEnv('SANDBOX_MAX_TIMEOUT_MS', 300_000),
    maxConcurrent: numEnv('SANDBOX_MAX_CONCURRENT', 4),
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
    stdoutMaxBytes: numEnv('SANDBOX_STDOUT_MAX_BYTES', 5 * 1024 * 1024),
    stderrMaxBytes: numEnv('SANDBOX_STDERR_MAX_BYTES', 5 * 1024 * 1024),
    outputFileMaxBytes: numEnv(
      'SANDBOX_OUTPUT_FILE_MAX_BYTES',
      50 * 1024 * 1024,
    ),
    outputTotalMaxBytes: numEnv(
      'SANDBOX_OUTPUT_TOTAL_MAX_BYTES',
      100 * 1024 * 1024,
    ),
  };
}
