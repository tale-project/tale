// runnerd wire protocol — MIRROR of
// services/sandbox/src/session/runnerd-protocol.ts (the canonical source).
//
// The daemon is bundled into the runtime image and cannot import across
// service boundaries (same convention as wire.ts ↔ convex/sandbox/wire.ts).
// Keep this in sync with the canonical file; protocol.test.ts pins the shapes.

export const RUNNERD_PORT = 8200;
export const RUNNERD_TOKEN_HEADER = 'x-tale-runnerd-token';
export const RUNNERD_TOKEN_CONTEXT = 'runnerd-v1:';

export const RUNNERD_MAX_LIVE_EXECS = 4;
export const RUNNERD_RING_BUFFER_BYTES = 256 * 1024;
export const RUNNERD_ENV_MAX_ENTRIES = 128;
export const RUNNERD_ENV_MAX_VALUE_BYTES = 32 * 1024;

export const RUNNERD_ENV_DENYLIST = ['HOME', 'PATH', 'TMPDIR'] as const;
export const RUNNERD_ENV_DENY_PREFIXES = ['TALE_RUNNERD_'] as const;
export const RUNNERD_ENV_DENY_PROXY_RE = /^(https?|no)_proxy$/i;

export function isDeniedEnvName(name: string): boolean {
  if ((RUNNERD_ENV_DENYLIST as readonly string[]).includes(name)) return true;
  if (RUNNERD_ENV_DENY_PROXY_RE.test(name)) return true;
  return RUNNERD_ENV_DENY_PREFIXES.some((p) => name.startsWith(p));
}

export interface RunnerdHealth {
  ok: true;
  bootedAtMs: number;
  lastActivityAtMs: number;
  liveExecs: number;
}

export interface RunnerdExecRequest {
  execId: string;
  command?: string[];
  shell?: string;
  cwd?: string;
  env?: Record<string, string>;
  stdinBase64?: string;
  timeoutMs: number;
  stdoutMaxBytes: number;
  stderrMaxBytes: number;
}

export type RunnerdExecEvent =
  | { t: 'start'; execId: string; startedAtMs: number }
  | { t: 'stdout'; b64: string }
  | { t: 'stderr'; b64: string }
  | {
      t: 'exit';
      exitCode: number;
      durationMs: number;
      truncated: { stdout: boolean; stderr: boolean };
      timedOut: boolean;
      cancelled: boolean;
    }
  | {
      t: 'fail';
      code: 'INVALID_CWD' | 'EXEC_LIMIT' | 'DUPLICATE_EXEC' | 'BAD_REQUEST';
      message: string;
    };

export interface RunnerdCancelResponse {
  killed: boolean;
}

export interface RunnerdExecStatus {
  execId: string;
  state: 'running' | 'exited';
  startedAtMs: number;
  exitCode: number | null;
}

export interface RunnerdEnvPatch {
  set?: Record<string, string>;
  unset?: string[];
}

export interface RunnerdEnvResponse {
  ok: true;
  denied: string[];
}

export interface RunnerdError {
  error: string;
  message?: string;
}

export const WORKSPACE_ROOT = '/workspace';
export const ID_ALPHABET_RE = /^[a-zA-Z0-9_-]{1,64}$/;
