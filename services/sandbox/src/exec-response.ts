// Shared terminal-response constructors for both execution backends.
//
// Docker (backend/local-workspace-run.ts) and Kubernetes
// (backend/kubernetes/k8s-backend.ts) legitimately compute their stdout/stderr
// pipelines and timings differently, but every terminal ExecuteResponse must
// be built through these constructors so the status/errorCode/exitCode
// coupling cannot drift between backends. The normative outcome table lives on
// `ExecutionBackend.execute` (backend/types.ts); exec-response.test.ts asserts
// the per-outcome invariants — it is the cross-backend contract test.

import { classifyFailure, type OomHint } from './exec-common.ts';
import type {
  ErrorCode,
  ExecuteResponse,
  OutputFile,
  PriorStageResult,
  UploadStats,
} from './types.ts';
import type { SandboxStepResult } from './wire.ts';

/**
 * Everything a backend has already computed by the time it returns: the capped
 * + stripped output buffers, harvest artifacts, and timing. Field semantics
 * (what `executeMs` covers, how stdout was capped) may differ per backend —
 * the constructors only own the status/errorCode/exitCode coupling.
 */
export interface ResponseParts {
  stdoutCapped: string;
  stderrCapped: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  durationMs: number;
  truncatedFiles: number;
  outputFiles: OutputFile[];
  steps?: SandboxStepResult[];
  uploadStats: UploadStats;
  timing: {
    stageMs: number;
    executeMs: number;
    harvestMs: number;
    uploadMs: number;
  };
  priorStage?: PriorStageResult;
}

type BaseFields = Pick<
  ExecuteResponse,
  | 'stdoutBase64'
  | 'stderrBase64'
  | 'durationMs'
  | 'truncated'
  | 'outputFiles'
  | 'steps'
  | 'uploadStats'
  | 'timing'
  | 'priorStage'
>;

function baseFields(parts: ResponseParts): BaseFields {
  return {
    stdoutBase64: Buffer.from(parts.stdoutCapped).toString('base64'),
    stderrBase64: Buffer.from(parts.stderrCapped).toString('base64'),
    durationMs: parts.durationMs,
    truncated: {
      stdout: parts.stdoutTruncated,
      stderr: parts.stderrTruncated,
      files: parts.truncatedFiles,
    },
    outputFiles: parts.outputFiles,
    ...(parts.steps !== undefined && { steps: parts.steps }),
    uploadStats: parts.uploadStats,
    timing: parts.timing,
    ...(parts.priorStage !== undefined && { priorStage: parts.priorStage }),
  };
}

/** Harvest-side failure flags, as reported by `harvestOutputDir`. */
interface HarvestFlags {
  quotaExhausted: boolean;
  uploadFailed: boolean;
  reportFailed: boolean;
  readFailed: boolean;
}

/**
 * Classify a harvest-side failure into a wire errorCode. Order matters:
 * quota > upload > report > read. Apply only when user code itself exited 0 —
 * a real runtime crash must not be masked by an upload hiccup (the upload
 * failure still shows in `uploadStats.failures`).
 */
export function classifyHarvestError(
  flags: HarvestFlags,
): { code: ErrorCode; message: string } | undefined {
  if (flags.quotaExhausted) {
    return {
      code: 'UPLOAD_QUOTA_EXCEEDED',
      message:
        'Per-run output-file quota exceeded; some files were not uploaded',
    };
  }
  if (flags.uploadFailed) {
    return {
      code: 'UPLOAD_FAILED',
      message: 'One or more output uploads failed',
    };
  }
  if (flags.reportFailed) {
    return {
      code: 'UPLOAD_REPORT_FAILED',
      message: 'Upload succeeded but report-back to platform failed',
    };
  }
  if (flags.readFailed) {
    return {
      code: 'HARVEST_READ_FAILED',
      message: "Couldn't read /user/output",
    };
  }
  return undefined;
}

/** Caller-initiated cancellation. Payload richness is best-effort per backend. */
export function buildCancelled(parts: ResponseParts): ExecuteResponse {
  return {
    status: 'cancelled',
    exitCode: null,
    errorCode: 'CANCELLED',
    errorMessage: 'Execution cancelled by client',
    ...baseFields(parts),
  };
}

/** User code exited 0. A harvest-side failure flips the status to failed. */
export function buildCompleted(
  parts: ResponseParts,
  harvestError?: { code: ErrorCode; message: string },
): ExecuteResponse {
  return {
    status: harvestError !== undefined ? 'failed' : 'completed',
    exitCode: 0,
    ...(harvestError !== undefined && {
      errorCode: harvestError.code,
      errorMessage: harvestError.message,
    }),
    ...baseFields(parts),
  };
}

/** User code exited non-zero — classify via the shared exit-code heuristics. */
export function buildRuntimeFailure(
  parts: ResponseParts,
  exitCode: number,
  stderrForClassify: string,
  hint?: OomHint,
): ExecuteResponse {
  const { code, message } = classifyFailure(exitCode, stderrForClassify, hint);
  return {
    status: 'failed',
    exitCode,
    errorCode: code,
    errorMessage: message,
    ...baseFields(parts),
  };
}

/**
 * The execution machinery itself wedged past every deadline (k8s: harvest
 * never terminated within timeout + backstop; docker's analogue is the outer
 * timeout, which surfaces as exit 124 through buildRuntimeFailure). Classified
 * as TIMEOUT — the deadline that expired derives from the user timeout.
 */
export function buildTimeoutBackstop(
  parts: ResponseParts,
  detail?: string,
): ExecuteResponse {
  return {
    status: 'failed',
    exitCode: 124,
    errorCode: 'TIMEOUT',
    errorMessage:
      detail !== undefined
        ? `Wall-clock timeout exceeded (${detail})`
        : 'Wall-clock timeout exceeded',
    ...baseFields(parts),
  };
}

/**
 * The harvest mechanism produced no result (k8s: no result line; docker
 * reaches the equivalent through `classifyHarvestError`'s read branch). When
 * the runner's real exit code was recovered out-of-band, keep it: exit 0 →
 * this constructor (read failure is the headline); non-zero → callers should
 * prefer buildRuntimeFailure so a real crash isn't masked.
 */
export function buildHarvestMissing(
  parts: ResponseParts,
  exitCode: number | null,
): ExecuteResponse {
  return {
    status: 'failed',
    exitCode,
    errorCode: 'HARVEST_READ_FAILED',
    errorMessage: "Couldn't read /user/output (no harvest result line)",
    ...baseFields(parts),
  };
}

/**
 * The runner CONTAINER terminated abnormally (k8s only: cgroup group OOM kill,
 * eviction — the in-container wrapper never wrote the exit-code file). A
 * surviving wrapper always exits 0, so this is unambiguous.
 */
export function buildRunnerKilled(
  parts: ResponseParts,
  exitCode: number,
  reason?: string,
): ExecuteResponse {
  if (reason === 'OOMKilled') {
    return {
      status: 'failed',
      exitCode: 137,
      errorCode: 'OOM',
      errorMessage: 'Runner container OOM-killed (memory limit exceeded)',
      ...baseFields(parts),
    };
  }
  return {
    status: 'failed',
    exitCode,
    errorCode: 'RUNTIME_ERROR',
    errorMessage: `Runner container terminated abnormally${reason !== undefined ? ` (${reason})` : ''}`,
    ...baseFields(parts),
  };
}

/**
 * The execution infrastructure (docker daemon, K8s API) failed — NOT the
 * user's code. exitCode is null by convention: there is no meaningful
 * user-code exit status to report.
 */
export function buildInfraFailure(
  parts: ResponseParts,
  message: string,
): ExecuteResponse {
  return {
    status: 'failed',
    exitCode: null,
    errorCode: 'SPAWNER_UNAVAILABLE',
    errorMessage: message,
    ...baseFields(parts),
  };
}
