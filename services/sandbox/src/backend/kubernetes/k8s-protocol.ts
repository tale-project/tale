// The in-Pod ↔ spawner contract for the exec-free transport.
//
// The runner, stage, and harvest containers share the `/user` emptyDir
// and coordinate through well-known files under `/user/.runtime/tale`:
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

export const TALE_DIR = '/user/.runtime/tale';
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
 * Progress line the harvest container prints the moment `waitForExitCode`
 * resolves — i.e. as soon as it stops waiting on the runner and starts
 * collecting. Two consumers on the spawner side:
 *   - runner-dead short-circuit: a runner container that terminated non-zero
 *     can never write the exit-code file (the wrapper died with it), so a
 *     missing started line means harvest is stuck waiting on a file that will
 *     never exist — the spawner stops waiting and classifies from the runner's
 *     terminated state. A present line means harvest is legitimately busy
 *     (uploading) and owns its own timeouts.
 *   - harvest-crash recovery: the line carries the runner's real exit code, so
 *     even when the harvest later crashes without a result line the spawner
 *     can report the true exitCode instead of null.
 */
export const HARVEST_STARTED_MARKER = '__TALE_HARVEST_STARTED__';

export interface HarvestStarted {
  exitCode: number;
  timedOut: boolean;
}

export function formatStartedLine(started: HarvestStarted): string {
  return `${HARVEST_STARTED_MARKER} ${JSON.stringify(started)}`;
}

/** Last started-marker line in the harvest logs, or null when absent. */
export function parseStartedLine(logs: string): HarvestStarted | null {
  const lines = logs.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line !== undefined && line.startsWith(HARVEST_STARTED_MARKER)) {
      const json = line.slice(HARVEST_STARTED_MARKER.length).trim();
      try {
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        return JSON.parse(json) as HarvestStarted;
      } catch (err) {
        console.warn(
          '[sandbox.k8s] failed to parse harvest started line:',
          err instanceof Error ? err.message : err,
        );
        return null;
      }
    }
  }
  return null;
}

/**
 * The harvest container's result, carried back to the spawner on the harvest
 * container's stdout. The spawner combines this with the runner container's
 * logs (which carry stdout) to assemble the final ExecuteResponse. stdout is
 * deliberately NOT here — it's the runner's logs, read separately.
 */
export interface K8sHarvestResult {
  exitCode: number;
  /**
   * Set only by the harvest fatal handler's fallback line: the harvest crashed
   * before producing a real result, so `exitCode` is a placeholder. The
   * spawner must take the exit code from the started line instead (or report
   * exitCode null when that is absent too) — never classify user code from a
   * fatal placeholder.
   */
  fatal?: boolean;
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
