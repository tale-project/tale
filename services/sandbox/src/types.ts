// HTTP request / response shapes for the sandbox spawner.
// Mirrors the Convex action's `executeCode` and the `code_run` tool output.

export type Language = 'python' | 'node';

export interface InputFileBase64 {
  name: string;
  contentBase64: string;
}

export interface ExecuteRequest {
  // Stable id from the Convex action; used for container name + label and
  // for /v1/cancel/:uuid. Caller must supply this so cancellation has
  // something to address before the spawner has finished spinning up.
  executionId: string;
  organizationId: string;
  language: Language;
  code: string;
  packages?: string[];
  inputFiles?: InputFileBase64[];
  timeoutMs?: number;
  options?: {
    allowSdist?: boolean;
    allowInstallScripts?: boolean;
  };
}

export type ErrorCode =
  | 'TIMEOUT'
  | 'OOM'
  | 'EGRESS_DENIED'
  | 'INSTALL_FAILED'
  | 'PACKAGE_NOT_FOUND'
  | 'QUOTA_EXCEEDED'
  | 'RUNTIME_ERROR'
  | 'SPAWNER_UNAVAILABLE'
  | 'CANCELLED';

export interface OutputFile {
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
  installMs: number | null;
  runMs: number | null;
  truncated: {
    stdout: boolean;
    stderr: boolean;
    files: number;
  };
  outputFiles: OutputFile[];
}

export interface CancelResponse {
  killed: boolean;
}

export interface SpawnerConfig {
  port: number;
  sandboxToken: string;
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
}
