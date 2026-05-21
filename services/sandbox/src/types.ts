// HTTP request / response shapes for the sandbox spawner.
// Mirrors the Convex action's `executeCode` and the agent's `artifact_run`.
//
// Wire-protocol enums live in `./wire.ts` (single source of truth); this
// file imports them as type aliases so existing call sites in spawn.ts,
// server.ts, docker-args.ts, etc. keep working unchanged.

import type { SandboxErrorCode, SandboxLanguage } from './wire.ts';

export type Language = SandboxLanguage;
export type ErrorCode = SandboxErrorCode;

export interface ExecuteRequest {
  // Stable id from the Convex action; used for container name + label and
  // for /v1/cancel/:id. Caller must supply this so cancellation has
  // something to address before the spawner has finished spinning up.
  executionId: string;
  organizationId: string;
  language: Language;
  code: string;
  packages?: string[];
  timeoutMs?: number;
  options?: {
    allowSdist?: boolean;
    allowInstallScripts?: boolean;
  };
}

export interface OutputFile {
  // Wire-format shape: bytes inline (base64). The Convex side uploads these
  // to `_storage` and persists a separate validator with `fileMetadataId`.
  name: string;
  contentBase64: string;
  size: number;
  contentType: string;
}

export interface ExecuteResponse {
  status: 'completed' | 'failed' | 'cancelled';
  exitCode: number | null;
  errorCode?: ErrorCode;
  errorMessage?: string;
  stdoutBase64: string;
  stderrBase64: string;
  durationMs: number;
  truncated: {
    stdout: boolean;
    stderr: boolean;
    files: number;
  };
  outputFiles: OutputFile[];
}

export interface SpawnerConfig {
  port: number;
  // Optional. When null AND `allowUnauth` is false the spawner refuses to
  // start; loaded via `loadConfig()` so the policy is decided once at boot.
  sandboxToken: string | null;
  // Explicit opt-in for development / rag-crawler parity flow (`bun dev`).
  // Defaults to false; loadConfig sets it from SANDBOX_ALLOW_UNAUTH.
  allowUnauth: boolean;
  runtimeImage: string;
  runtime: 'runc' | 'runsc';
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
  maxConcurrent: number;
  hostSessionRoot: string;
  cacheVolumePrefix: { pip: string; npm: string };
  egressNetwork: string;
  egressProxy: string;
  stdoutMaxBytes: number;
  stderrMaxBytes: number;
  outputFileMaxBytes: number;
  outputTotalMaxBytes: number;
  // Maximum request body size (bytes) for /v1/execute. Defaults to 256 KB
  // to bound the unsigned-mode OOM surface (audit finding).
  maxRequestBodyBytes: number;
}
