// In-Pod `harvest` container entry mode (runs the SPAWNER image).
//
// Runs alongside the runner, sharing the /user emptyDir. It owns the
// SANDBOX_TOKEN + presigned upload slots (from the per-exec Secret) so the
// runner never sees a credential. Flow:
//   1. Wait for the runner to finish (poll EXIT_CODE_PATH), bounded by the
//      spec timeout — the exec-free analogue of the docker inner SIGKILL. On
//      self-timeout we harvest partial output with exitCode 124 (TIMEOUT).
//   2. Read the runner's exit code + separated stderr (STDERR_PATH).
//   3. Run the SAME `harvestOutputDir` the docker path uses: upload each
//      /user/output file to a presigned slot + EP1/EP2.
//   4. Print ONE `__TALE_RESULT__ {json}` line to stdout; the owning spawner
//      replica reads it back via readNamespacedPodLog (no websocket, no
//      cross-replica callback) and assembles the ExecuteResponse.
//
// The spawner keys completion off THIS container terminating — so on timeout
// the runner can still be running when we print + exit; the spawner reads our
// result, then deletes the Pod (killing the runner). That preserves partial
// output on timeout, matching docker.

import { open, readFile } from 'node:fs/promises';

import {
  harvestOutputDir,
  readStepResults,
  synthesizeStepResults,
} from '../../exec-common.ts';
import { EXEC_SPEC_PATH, parseExecSpec, type ExecSpec } from './exec-spec.ts';
import {
  EXIT_CODE_PATH,
  PRESTAGE_PATH,
  RUNNER_STARTED_PATH,
  STDERR_PATH,
  formatResultLine,
  formatStartedLine,
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
  // Head-read at most maxBytes+1 via the fd — STDERR_PATH sits on the
  // size-unbounded workspace volume, so a whole-file readFile of a runaway
  // stderr (GBs) would OOM this container and lose the entire result line.
  let fh: Awaited<ReturnType<typeof open>> | undefined;
  try {
    fh = await open(path, 'r');
    const buf = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await fh.read(buf, 0, maxBytes + 1, 0);
    if (bytesRead <= maxBytes) {
      return {
        text: buf.subarray(0, bytesRead).toString('utf8'),
        truncated: false,
      };
    }
    return {
      text: buf.subarray(0, maxBytes).toString('utf8'),
      truncated: true,
    };
  } catch (err) {
    if (isENOENT(err)) return { text: '', truncated: false };
    console.warn(`[sandbox.harvest] failed to read ${path}:`, err);
    return { text: '', truncated: false };
  } finally {
    await fh?.close().catch((err: unknown) => {
      console.warn(`[sandbox.harvest] close ${path} failed:`, err);
    });
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

async function readRunnerStartedAtMs(): Promise<number | undefined> {
  try {
    const raw = (await readFile(RUNNER_STARTED_PATH, 'utf8')).trim();
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  } catch (err) {
    if (!isENOENT(err)) {
      console.warn('[sandbox.harvest] runner-started-at read error:', err);
    }
  }
  return undefined;
}

async function run(spec: ExecSpec): Promise<K8sHarvestResult> {
  const { req, caps } = spec;

  const { exitCode, timedOut } = await waitForExitCode(spec.timeoutMs);
  // Capture immediately after the runner exits so executeMs reflects actual
  // container run time rather than harvest work time.
  const runnerFinishedAtMs = Date.now();
  // Progress marker: tells the spawner we're past the exit-code wait (so a
  // dead runner can't be the reason we're silent) and carries the real exit
  // code so it survives even a later harvest crash.
  process.stdout.write(`${formatStartedLine({ exitCode, timedOut })}\n`);
  if (timedOut) {
    console.warn(
      `[sandbox.harvest] runner did not exit within ${spec.timeoutMs}ms; harvesting partial output (exit 124)`,
    );
  }

  const stderr = await readCapped(STDERR_PATH, caps.stderrMaxBytes);
  const prestage = await readPrestage();
  const runnerStartedAtMs = await readRunnerStartedAtMs();
  const executeMs =
    runnerStartedAtMs !== undefined
      ? Math.max(0, runnerFinishedAtMs - runnerStartedAtMs)
      : undefined;

  // Mirror the docker path (local-workspace-run.ts): a harvest crash must not
  // erase the result line — degrade to readFailed and ship the real exitCode,
  // stderr, and steps. On the timeout path we deliberately walk /user
  // while the runner is still alive, so transient fs races are expected here.
  let harvested: Awaited<ReturnType<typeof harvestOutputDir>> = {
    files: [],
    truncatedCount: 0,
    uploadStats: { attempted: 0, succeeded: 0, failures: [] },
    quotaExhausted: false,
    uploadFailed: false,
    reportFailed: false,
    readFailed: false,
    uploadMs: 0,
  };
  const harvestStartedAt = Date.now();
  try {
    harvested = await harvestOutputDir(
      '/user',
      {
        perFileMax: caps.outputFileMaxBytes,
        totalMax: caps.outputTotalMaxBytes,
      },
      req.outputUploadSlots,
      {
        outputUrlEndpoint: req.outputUrlEndpoint,
        reportUploadedEndpoint: req.reportUploadedEndpoint,
      },
      req.executionId,
      spec.sandboxToken,
    );
  } catch (err) {
    console.warn('[sandbox.harvest] best-effort harvest failed:', err);
    harvested = { ...harvested, readFailed: true };
  }
  const harvestMs = Date.now() - harvestStartedAt;

  const steps =
    req.steps !== undefined
      ? ((await readStepResults('/user', req.steps)) ??
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
    ...(executeMs !== undefined && { executeMs }),
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
  // Last-resort result line so a helper crash degrades to readFailed instead
  // of erasing the whole result. `fatal` tells the spawner the exitCode is a
  // placeholder — it recovers the real one from the started line if present.
  try {
    const fallback: K8sHarvestResult = {
      fatal: true,
      exitCode: 1,
      stderr: '',
      stderrTruncated: false,
      outputFiles: [],
      truncatedFiles: 0,
      uploadStats: { attempted: 0, succeeded: 0, failures: [] },
      quotaExhausted: false,
      uploadFailed: false,
      reportFailed: false,
      readFailed: true,
      stageMs: 0,
      harvestMs: 0,
      uploadMs: 0,
    };
    process.stdout.write(`${formatResultLine(fallback)}\n`);
  } catch (writeErr) {
    console.error('[sandbox.harvest] fallback result line failed:', writeErr);
  }
  process.exit(0);
});
