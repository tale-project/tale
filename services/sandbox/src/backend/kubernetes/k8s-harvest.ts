// In-Pod `harvest` container entry mode (runs the SPAWNER image).
//
// Runs alongside the runner, sharing the /workspace emptyDir. It owns the
// SANDBOX_TOKEN + presigned upload slots (from the per-exec Secret) so the
// runner never sees a credential. Flow:
//   1. Wait for the runner to finish (poll EXIT_CODE_PATH), bounded by the
//      spec timeout — the exec-free analogue of the docker inner SIGKILL. On
//      self-timeout we harvest partial output with exitCode 124 (TIMEOUT).
//   2. Read the runner's exit code + separated stderr (STDERR_PATH).
//   3. Run the SAME `harvestOutputDir` the docker path uses: upload each
//      /workspace/output file to a presigned slot + EP1/EP2.
//   4. Print ONE `__TALE_RESULT__ {json}` line to stdout; the owning spawner
//      replica reads it back via readNamespacedPodLog (no websocket, no
//      cross-replica callback) and assembles the ExecuteResponse.
//
// The spawner keys completion off THIS container terminating — so on timeout
// the runner can still be running when we print + exit; the spawner reads our
// result, then deletes the Pod (killing the runner). That preserves partial
// output on timeout, matching docker.

import { readFile } from 'node:fs/promises';

import {
  harvestOutputDir,
  readStepResults,
  synthesizeStepResults,
} from '../../exec-common.ts';
import { EXEC_SPEC_PATH, parseExecSpec, type ExecSpec } from './exec-spec.ts';
import {
  EXIT_CODE_PATH,
  PRESTAGE_PATH,
  STDERR_PATH,
  formatResultLine,
  type K8sHarvestResult,
  type PrestageFile,
} from './k8s-protocol.ts';

const POLL_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isENOENT(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === 'object' &&
    'code' in err &&
    err.code === 'ENOENT'
  );
}

/**
 * Poll for the runner's exit-code file, bounded by the spec timeout. The
 * runner writes it last (`...; echo $? > exit-code`), so its presence means
 * user code has fully exited. On timeout we report 124 and harvest whatever
 * partial output exists.
 */
async function waitForExitCode(
  timeoutMs: number,
): Promise<{ exitCode: number; timedOut: boolean }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const raw = (await readFile(EXIT_CODE_PATH, 'utf8')).trim();
      if (raw.length > 0) {
        const n = Number(raw);
        return { exitCode: Number.isInteger(n) ? n : 1, timedOut: false };
      }
    } catch (err) {
      if (!isENOENT(err)) {
        console.warn('[sandbox.harvest] exit-code read error:', err);
      }
    }
    if (Date.now() >= deadline) return { exitCode: 124, timedOut: true };
    await sleep(POLL_MS);
  }
}

async function readCapped(
  path: string,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  try {
    const buf = await readFile(path);
    if (buf.byteLength <= maxBytes) {
      return { text: buf.toString('utf8'), truncated: false };
    }
    return {
      text: buf.subarray(0, maxBytes).toString('utf8'),
      truncated: true,
    };
  } catch (err) {
    if (isENOENT(err)) return { text: '', truncated: false };
    console.warn(`[sandbox.harvest] failed to read ${path}:`, err);
    return { text: '', truncated: false };
  }
}

async function readPrestage(): Promise<PrestageFile> {
  try {
    const raw = await readFile(PRESTAGE_PATH, 'utf8');
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    return JSON.parse(raw) as PrestageFile;
  } catch (err) {
    if (!isENOENT(err)) {
      console.warn('[sandbox.harvest] failed to read prestage:', err);
    }
    return { stageMs: 0 };
  }
}

async function run(spec: ExecSpec): Promise<K8sHarvestResult> {
  const { req, caps } = spec;

  const { exitCode, timedOut } = await waitForExitCode(spec.timeoutMs);
  if (timedOut) {
    console.warn(
      `[sandbox.harvest] runner did not exit within ${spec.timeoutMs}ms; harvesting partial output (exit 124)`,
    );
  }

  const stderr = await readCapped(STDERR_PATH, caps.stderrMaxBytes);
  const prestage = await readPrestage();

  const harvestStartedAt = Date.now();
  const harvested = await harvestOutputDir(
    '/workspace',
    { perFileMax: caps.outputFileMaxBytes, totalMax: caps.outputTotalMaxBytes },
    req.outputUploadSlots,
    {
      outputUrlEndpoint: req.outputUrlEndpoint,
      reportUploadedEndpoint: req.reportUploadedEndpoint,
    },
    req.executionId,
    spec.sandboxToken,
  );
  const harvestMs = Date.now() - harvestStartedAt;

  const steps =
    req.steps !== undefined
      ? ((await readStepResults('/workspace', req.steps)) ??
        synthesizeStepResults(req.steps))
      : undefined;

  return {
    exitCode,
    stderr: stderr.text,
    stderrTruncated: stderr.truncated,
    outputFiles: harvested.files,
    truncatedFiles: harvested.truncatedCount,
    uploadStats: harvested.uploadStats,
    quotaExhausted: harvested.quotaExhausted,
    uploadFailed: harvested.uploadFailed,
    reportFailed: harvested.reportFailed,
    readFailed: harvested.readFailed,
    stageMs: prestage.stageMs,
    harvestMs,
    uploadMs: harvested.uploadMs,
    ...(steps !== undefined && { steps }),
    ...(prestage.priorStage !== undefined && {
      priorStage: prestage.priorStage,
    }),
  };
}

async function main(): Promise<void> {
  const raw = await readFile(EXEC_SPEC_PATH, 'utf8');
  const spec = parseExecSpec(raw);
  const result = await run(spec);
  // The single contract line the spawner parses. Write it as one syscall so it
  // can't interleave with other stdout.
  process.stdout.write(`${formatResultLine(result)}\n`);
}

main().catch((err: unknown) => {
  // Even on a fatal harvest error we exit 0: a non-zero harvest container would
  // make the Pod phase Failed for a reason unrelated to the user's code, and
  // the spawner already treats a missing result line as a synthesized failure.
  console.error(
    '[sandbox.harvest] fatal:',
    err instanceof Error ? (err.stack ?? err.message) : err,
  );
  process.exit(0);
});
