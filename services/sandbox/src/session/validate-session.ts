// Hand-rolled runtime validators for the /v1/sessions request bodies. Same
// zero-dependency discipline as validate-request.ts: the boundary between an
// unknown wire object and the typed shapes the session pipeline accepts.

import type { SpawnerConfig } from '../types.ts';
import {
  EXEC_ID_RE,
  ID_ALPHABET_RE,
  ORG_ID_ALPHABET_RE,
  sandboxSessionProfileLiterals,
  type SandboxSessionProfile,
} from '../wire.ts';
import {
  RUNNERD_ENV_MAX_ENTRIES,
  isDeniedEnvName,
} from './runnerd-protocol.ts';

const MAX_ENV_VALUE = 32 * 1024;

export interface CreateSessionRequest {
  sessionId: string;
  organizationId: string;
  profile: SandboxSessionProfile;
  ttlMs: number;
  idleTimeoutMs: number;
  env: Record<string, string>;
}

export interface ExecSessionRequest {
  execId: string;
  command?: string[];
  shell?: string;
  cwd?: string;
  env?: Record<string, string>;
  stdinBase64?: string;
  timeoutMs: number;
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function validateEnv(v: unknown): Result<Record<string, string>> {
  if (v === undefined) return { ok: true, value: {} };
  if (!isObj(v)) return { ok: false, error: 'env must be an object' };
  const entries = Object.entries(v);
  if (entries.length > RUNNERD_ENV_MAX_ENTRIES) {
    return {
      ok: false,
      error: `env exceeds ${RUNNERD_ENV_MAX_ENTRIES} entries`,
    };
  }
  const out: Record<string, string> = {};
  for (const [k, val] of entries) {
    if (typeof val !== 'string') {
      return { ok: false, error: `env.${k} must be a string` };
    }
    if (val.length > MAX_ENV_VALUE) {
      return { ok: false, error: `env.${k} value too large` };
    }
    // Deny-listed names are silently dropped here (runnerd re-enforces); a
    // caller setting HOME isn't an error, it just can't take effect.
    if (!isDeniedEnvName(k)) out[k] = val;
  }
  return { ok: true, value: out };
}

export function validateCreateSession(
  raw: unknown,
  cfg: SpawnerConfig,
): Result<CreateSessionRequest> {
  if (!isObj(raw)) return { ok: false, error: 'body must be a JSON object' };
  if (
    typeof raw.sessionId !== 'string' ||
    !ID_ALPHABET_RE.test(raw.sessionId)
  ) {
    return { ok: false, error: 'sessionId is missing or malformed' };
  }
  if (
    typeof raw.organizationId !== 'string' ||
    !ORG_ID_ALPHABET_RE.test(raw.organizationId)
  ) {
    return { ok: false, error: 'organizationId is missing or malformed' };
  }
  const rawProfile = raw.profile;
  if (
    rawProfile !== undefined &&
    (typeof rawProfile !== 'string' ||
      !(sandboxSessionProfileLiterals as readonly string[]).includes(
        rawProfile,
      ))
  ) {
    return { ok: false, error: 'profile must be default|agent' };
  }
  // Narrow to the union without an assertion (only 'agent' | 'default' reach
  // here after the guard above).
  const profile: SandboxSessionProfile =
    rawProfile === 'agent' ? 'agent' : 'default';
  // ttl/idle clamped to the configured ceilings (a caller may request less).
  const ttlMs = clampPositive(
    raw.ttlMs,
    cfg.session.maxLifetimeMs,
    cfg.session.maxLifetimeMs,
  );
  const idleTimeoutMs = clampPositive(
    raw.idleTimeoutMs,
    cfg.session.maxIdleMs,
    cfg.session.maxIdleMs,
  );
  const env = validateEnv(raw.env);
  if (!env.ok) return env;
  return {
    ok: true,
    value: {
      sessionId: raw.sessionId,
      organizationId: raw.organizationId,
      profile,
      ttlMs,
      idleTimeoutMs,
      env: env.value,
    },
  };
}

export function validateExecSession(
  raw: unknown,
  cfg: SpawnerConfig,
): Result<ExecSessionRequest> {
  if (!isObj(raw)) return { ok: false, error: 'body must be a JSON object' };
  if (typeof raw.execId !== 'string' || !EXEC_ID_RE.test(raw.execId)) {
    return { ok: false, error: 'execId is missing or malformed' };
  }
  // Capture into consts so Array.isArray / typeof narrow the value itself
  // (re-reading raw.command would re-widen it to unknown) — no assertions.
  const command = raw.command;
  const shell = raw.shell;
  const cwd = raw.cwd;
  const stdinBase64 = raw.stdinBase64;
  const hasCommand = Array.isArray(command);
  const hasShell = typeof shell === 'string';
  if (hasCommand === hasShell) {
    return { ok: false, error: 'exactly one of command[] or shell required' };
  }
  let commandStrings: string[] | undefined;
  if (Array.isArray(command)) {
    commandStrings = command.filter((s): s is string => typeof s === 'string');
    if (command.length === 0 || commandStrings.length !== command.length) {
      return { ok: false, error: 'command must be a non-empty string[]' };
    }
  }
  if (cwd !== undefined && typeof cwd !== 'string') {
    return { ok: false, error: 'cwd must be a string' };
  }
  if (stdinBase64 !== undefined && typeof stdinBase64 !== 'string') {
    return { ok: false, error: 'stdinBase64 must be a string' };
  }
  const env = validateEnv(raw.env);
  if (!env.ok) return env;
  const timeoutMs = clampPositive(
    raw.timeoutMs,
    cfg.session.execDefaultTimeoutMs,
    cfg.session.execMaxTimeoutMs,
  );
  const value: ExecSessionRequest = {
    execId: raw.execId,
    env: env.value,
    timeoutMs,
  };
  if (commandStrings) value.command = commandStrings;
  if (typeof shell === 'string') value.shell = shell;
  if (typeof cwd === 'string') value.cwd = cwd;
  if (typeof stdinBase64 === 'string') value.stdinBase64 = stdinBase64;
  return { ok: true, value };
}

/** Returns `fallback` when absent/invalid; otherwise the value clamped to
 * (0, max]. */
function clampPositive(v: unknown, fallback: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return fallback;
  return Math.min(v, max);
}
