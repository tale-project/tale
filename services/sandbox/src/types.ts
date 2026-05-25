// HTTP request / response shapes for the sandbox spawner.
// Mirrors the Convex action's `executeCode` and the agent's `artifact_run`.
//
// Wire-protocol enums live in `./wire.ts` (single source of truth); this
// file imports them as type aliases so existing call sites in spawn.ts,
// server.ts, docker-args.ts, etc. keep working unchanged.

import type {
  SandboxErrorCode,
  SandboxLanguage,
  SandboxStepResult,
} from './wire.ts';

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
  /**
   * URL the spawner GETs to fetch the file bytes. Pre-rewritten through
   * `toSandboxStorageUrl()` on the platform side to target the internal
   * Caddy alias (`http://proxy/...`). Binary-safe — bytes are streamed
   * directly to disk, never JSON-stringified.
   */
  url: string;
}

export interface ExecuteRequest {
  // Stable id from the Convex action; used for container name + label and
  // for /v1/cancel/:id. Caller must supply this so cancellation has
  // something to address before the spawner has finished spinning up.
  executionId: string;
  organizationId: string;
  language: Language;
  /**
   * Files to stage under /workspace/code/<path>. Required: in single-script
   * mode the entry file lives here; in multi-script mode all steps + their
   * siblings live here. Each entry carries a URL the spawner GETs to fetch
   * the bytes (binary-safe; replaces the legacy inline `content: string`).
   * Per-file path validated against MAX_PATH_LENGTH + POSIX-traversal rules.
   * Path segments starting with `.` are rejected, so user files can never
   * land inside `/workspace/.tale/` where the multi-step wrapper goes.
   */
  files?: SandboxFile[];
  /**
   * Single-script mode: relative path inside `files[]` to exec. The
   * runtime image's entrypoint receives this as a positional arg and
   * exec()s `/workspace/code/<entryPath>` directly — no synthetic mirror,
   * so user filenames (including `main.py`) flow through unchanged and
   * appear verbatim in tracebacks. Must reference an existing entry in
   * `files[]` with non-empty content. Mutually exclusive with `steps`:
   * requests must set exactly one of `entryPath` or `steps`.
   */
  entryPath?: string;
  /**
   * Multi-script mode: paths inside `files[]` to execute in sequence
   * within the same container, sharing /workspace/. Spawner writes a
   * generated wrapper to `/workspace/.tale/runner.{py,js}` (a dir
   * unreachable from user paths) and the entrypoint exec()s that wrapper,
   * which subprocess-invokes each step path. Fail-fast on first non-zero
   * exit. Per-step results (exit code, duration, status) come back in
   * `ExecuteResponse.steps[]`. Mutually exclusive with `entryPath`.
   */
  steps?: string[];
  /**
   * Prior-run output downloads. Spawner fetches each URL during
   * `stageWorkspace` and writes the bytes to `/workspace/output/<name>`.
   * Replaces the legacy inline-base64 `priorOutputFiles[]` field
   * (sandbox-wobbly-origami plan §1). Names are validated against the
   * same POSIX-traversal rules; rejects skip (logged, not fatal).
   */
  priorOutputDownloads?: Array<{
    name: string;
    url: string;
  }>;
  /**
   * Legacy single-bucket package list. Sent for `python` / `node`
   * single-runtime requests and routed to either `uv pip install` or
   * `npm install` based on `language`. Polyglot requests should use
   * {@link packagesByLang} instead.
   */
  packages?: string[];
  /**
   * Per-runtime package buckets. When `language === 'polyglot'` the
   * entrypoint runs `uv pip install` for `python` and `npm install` for
   * `node` (skipping whichever bucket is absent / empty). Also accepted
   * for `python` / `node` single-runtime requests; the matching bucket
   * is used and the other is ignored.
   */
  packagesByLang?: {
    python?: string[];
    node?: string[];
  };
  timeoutMs?: number;
  options?: {
    allowSdist?: boolean;
    allowInstallScripts?: boolean;
  };
  /**
   * Pre-allocated upload-slot URLs the spawner POSTs harvested output
   * files to. Length = platform's pre-alloc N (defaults to 2). When the
   * spawner exhausts this pool it lazily requests more via
   * {@link outputUrlEndpoint}.
   */
  outputUploadSlots: Array<{ url: string }>;
  /**
   * HMAC-signed callback URL for requesting additional upload slots when
   * the pre-allocated pool is empty (EP1; sandbox-wobbly-origami plan §2).
   */
  outputUrlEndpoint: string;
  /**
   * HMAC-signed callback URL the spawner POSTs to AFTER each successful
   * upload, so the platform tracks `{fileName, storageId, ...}` against
   * the audit row's rollback set (EP2; sandbox-wobbly-origami plan §2).
   */
  reportUploadedEndpoint: string;
}

/**
 * Per-file harvest outcome. `storageId` is the Convex storage id allocated
 * when the spawner POSTed the bytes to the pre-signed upload URL; the
 * platform side just inserts the matching `fileMetadata` row.
 *
 * `sha256` (hex) is the digest of the raw bytes computed during harvest.
 * Used for the cumulative `artifactOutputs` manifest (crispy-curry plan §1)
 * and for pre-stage attestation when the same file is later re-injected
 * into another run's `/workspace/output/`.
 */
export interface OutputFile {
  name: string;
  storageId: string;
  size: number;
  contentType: string;
  sha256: string;
}

/**
 * Pre-stage skip reasons reported back to the platform via
 * `ExecuteResponse.priorStage.skipped`. The platform diffs the spawner's
 * `staged[]` against the manifest it sent; any name in the manifest that's
 * missing from `staged[]` triggers a fatal `PRE_STAGE_FAILED` BEFORE user
 * code runs (crispy-curry plan §3).
 */
export type PriorStageSkipReason =
  | 'unsafe_path'
  | 'fetch_failed'
  | 'fetch_timeout'
  | 'http_error'
  | 'url_expired'
  | 'write_failed'
  | 'download_too_large';

/**
 * Per-file pre-stage outcome. `bytes` and `sha256` are populated only for
 * successfully staged files; skipped entries carry a structured reason +
 * short detail string the platform can surface in the failure payload.
 */
export interface PriorStageResult {
  staged: Array<{ name: string; bytes: number; sha256: string }>;
  skipped: Array<{
    name: string;
    reason: PriorStageSkipReason;
    detail: string;
  }>;
}

/**
 * Per-file upload failure (for `ExecuteResponse.uploadStats`). Surfaces
 * the HTTP failure code + a short stderr snippet so the audit row /
 * artifact_run_tool can show useful context without dumping kB of body.
 */
export interface UploadFailure {
  slotIndex: number;
  fileName: string;
  httpStatus: number;
  errorSnippet: string;
}

export interface UploadStats {
  attempted: number;
  succeeded: number;
  failures: UploadFailure[];
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
  /**
   * Populated only for multi-step (`ExecuteRequest.steps`) requests; one
   * entry per requested step. Omitted entirely in single-script mode so
   * existing callers don't have to thread the field through.
   */
  steps?: SandboxStepResult[];
  /**
   * Upload telemetry — per-file attempted / succeeded counts plus per-
   * failure detail. Always present in new responses; the platform-side
   * validator allows omission for old-image back-compat.
   */
  uploadStats?: UploadStats;
  /**
   * Per-phase timing breakdown (ms): `stageMs` (prior-output fetch +
   * file writes), `executeMs` (inner docker run), `harvestMs` (output
   * walk), `uploadMs` (presigned-URL POSTs + EP2 round-trips).
   */
  timing?: {
    stageMs: number;
    executeMs: number;
    harvestMs: number;
    uploadMs: number;
  };
  /**
   * Pre-stage attestation (crispy-curry plan §3). For every entry in
   * `ExecuteRequest.priorOutputDownloads` the spawner reports back whether
   * it landed on `/workspace/output/` (`staged[]`, with bytes + sha256) or
   * was skipped (`skipped[]`, with a structured reason).
   *
   * The platform diffs `staged[]` against the manifest it sent and aborts
   * the run with `PRE_STAGE_FAILED` if any expected file is missing —
   * BEFORE user code runs, so the script never sees a partially-corrupted
   * workspace. Omitted from the response only when the request had no
   * `priorOutputDownloads` (nothing to attest).
   */
  priorStage?: PriorStageResult;
}

export interface SpawnerConfig {
  port: number;
  // Token policy: opt-in verification. When null, the spawner skips HMAC
  // checks on every route (a single warn at boot logs the state). When
  // set, the wire path enforces signatures. Set by `loadConfig()` once
  // at boot from `SANDBOX_TOKEN`; empty-string is treated as null.
  sandboxToken: string | null;
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
