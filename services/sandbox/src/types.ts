// HTTP request / response shapes for the sandbox spawner.
// Mirrors the Convex action's `executeCode` and the agent's `artifact_run`.
//
// Wire-protocol enums live in `./wire.ts` (single source of truth); this
// file imports them as type aliases so existing call sites in spawn.ts,
// server.ts, docker-args.ts, etc. keep working unchanged.

import type { SandboxErrorCode, SandboxLanguage } from './wire.ts';

export type Language = SandboxLanguage;
export type ErrorCode = SandboxErrorCode;

export interface SandboxFile {
  /**
   * POSIX-style relative path within /workspace/code/. Validated against
   * the path-safety rules in validate-request.ts (no traversal, no NUL,
   * no backslash, etc). Nested directories allowed; spawner mkdirs the
   * parent on write.
   */
  path: string;
  content: string;
}

export interface ExecuteRequest {
  // Stable id from the Convex action; used for container name + label and
  // for /v1/cancel/:id. Caller must supply this so cancellation has
  // something to address before the spawner has finished spinning up.
  executionId: string;
  organizationId: string;
  language: Language;
  /**
   * The script content that the runtime entrypoint executes. The
   * spawner writes this verbatim to /workspace/code/main.{py,js}
   * regardless of whether `files` is set — that's the file the runtime
   * image's entrypoint shell exec()s. When `files` AND `entryPath` are
   * provided, the caller sets `code` to the chosen entry file's content
   * so old runtime images keep working (cross-deploy compat).
   */
  code: string;
  /**
   * Optional sibling files to stage alongside the executed script. Each
   * entry is written to /workspace/code/<path>. Enables Python `import
   * helpers` / Node `require('./helpers')` between artifact files in the
   * same run. Aggregate size capped at MAX_FILES_BYTES; per-file path
   * validated against MAX_PATH_LENGTH + POSIX-traversal rules.
   */
  files?: SandboxFile[];
  /**
   * Path of the file in `files` that the caller intends as the entry. The
   * spawner uses this to know which file's content was mirrored into
   * `code`; it does NOT change which file the runtime exec()s (that's
   * always main.{py,js}). Future runtime-image versions may consult this
   * to support arbitrary entry paths.
   */
  entryPath?: string;
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
