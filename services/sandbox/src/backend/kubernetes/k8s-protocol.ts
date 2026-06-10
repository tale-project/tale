// The in-Pod ↔ spawner contract for the exec-free transport.
//
// The runner, stage, and harvest containers share the `/workspace` emptyDir
// and coordinate through well-known files under `/workspace/.tale`:
//   - the runner writes its exit code to EXIT_CODE_PATH and redirects its
//     stderr to STDERR_PATH (the K8s log API merges stdout+stderr, so stderr
//     stays on disk and the runner's logs are clean stdout for phase parsing).
//   - the stage initContainer writes PRESTAGE_PATH (attestation + stage timing).
//   - the harvest container reads all three, uploads outputs, and prints ONE
//     result line (`__TALE_RESULT__ {json}`) to its OWN stdout, which the
//     owning spawner replica reads back via readNamespacedPodLog. No websocket,
//     no cross-replica callback — the result rides the harvest container's logs.

import type { OutputFile, PriorStageResult, UploadStats } from '../../types.ts';
import type { SandboxStepResult } from '../../wire.ts';

export const TALE_DIR = '/workspace/.tale';
export const EXIT_CODE_PATH = `${TALE_DIR}/exit-code`;
export const STDERR_PATH = `${TALE_DIR}/stderr.log`;
export const PRESTAGE_PATH = `${TALE_DIR}/prestage.json`;

/** What the stage initContainer persists for the harvest container to forward. */
export interface PrestageFile {
  stageMs: number;
  priorStage?: PriorStageResult;
}

/** Prefix of the single stdout line the harvest container emits its result on. */
export const RESULT_MARKER = '__TALE_RESULT__';

/**
 * The harvest container's result, carried back to the spawner on the harvest
 * container's stdout. The spawner combines this with the runner container's
 * logs (which carry stdout) to assemble the final ExecuteResponse. stdout is
 * deliberately NOT here — it's the runner's logs, read separately.
 */
export interface K8sHarvestResult {
  exitCode: number;
  /** Capped runner stderr (read from STDERR_PATH); plain text, spawner base64s. */
  stderr: string;
  stderrTruncated: boolean;
  outputFiles: OutputFile[];
  /** Count of output files skipped for exceeding the per-file / total caps. */
  truncatedFiles: number;
  uploadStats: UploadStats;
  quotaExhausted: boolean;
  uploadFailed: boolean;
  reportFailed: boolean;
  readFailed: boolean;
  stageMs: number;
  harvestMs: number;
  uploadMs: number;
  steps?: SandboxStepResult[];
  priorStage?: PriorStageResult;
}

/** Serialize a result as the single marker line the harvest prints to stdout. */
export function formatResultLine(result: K8sHarvestResult): string {
  // JSON.stringify escapes all newlines, so the marker + payload is one line.
  return `${RESULT_MARKER} ${JSON.stringify(result)}`;
}

/**
 * Extract the harvest result from the harvest container's full logs. Scans
 * from the end for the last marker line (defensive against any stray earlier
 * output). Returns null if absent (Pod deleted before harvest printed, or the
 * line was malformed) — the spawner then synthesizes a response from Pod
 * status.
 */
export function parseResultLine(logs: string): K8sHarvestResult | null {
  const lines = logs.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line !== undefined && line.startsWith(RESULT_MARKER)) {
      const json = line.slice(RESULT_MARKER.length).trim();
      try {
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        return JSON.parse(json) as K8sHarvestResult;
      } catch (err) {
        console.warn(
          '[sandbox.k8s] failed to parse harvest result line:',
          err instanceof Error ? err.message : err,
        );
        return null;
      }
    }
  }
  return null;
}
