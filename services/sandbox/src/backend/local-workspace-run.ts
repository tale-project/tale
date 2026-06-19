// The local-workspace execution flow: stage inputs onto a local directory,
// run the runtime against it, parse PHASE markers + live tail off its stdout,
// then harvest `/user/output` back from the same local directory. This is
// the body that used to live inline in spawn.ts's `executeRequest`; it is
// behavior-identical (the existing spawn-staging / spawn-prior-outputs / e2e
// tests are the parity proof).
//
// It is generic over a `LocalWorkspaceRuntime` (createWorkspace / launch /
// ensureCacheStore), so the DockerBackend delegates its `execute()` straight
// here. A non-shared-fs backend (KubernetesBackend exec-free) does NOT use
// this — it moves staging/harvest into the Pod and implements `execute()`
// directly.

import {
  capText,
  createStreamScanner,
  harvestOutputDir,
  makeError,
  readStepResults,
  stageWorkspace,
  stripControlChars,
  stripPhaseMarkers,
  synthesizeStepResults,
} from '../exec-common.ts';
import {
  buildCancelled,
  buildCompleted,
  buildInfraFailure,
  buildRuntimeFailure,
  classifyHarvestError,
  type ResponseParts,
} from '../exec-response.ts';
import type {
  ExecuteRequest,
  ExecuteResponse,
  OutputFile,
  SpawnerConfig,
  UploadStats,
} from '../types.ts';
import { ID_ALPHABET_RE } from '../wire.ts';
import type {
  ExecuteOptions,
  LocalWorkspaceRuntime,
  RunningExecution,
  RunResult,
  Workspace,
} from './types.ts';

// Docker-CLI exit codes that can mean "the daemon/CLI failed", not user code
// (125 daemon error, 126 not-runnable, 127 not-found). A user process can
// legitimately exit with these too, so the stderr signature must ALSO match
// before we classify the failure as infrastructure.
const DOCKER_INFRA_EXITS = new Set([125, 126, 127]);
const DOCKER_INFRA_STDERR_RE =
  /docker: error response from daemon|cannot connect to the docker daemon|error during connect/i;

export async function runLocalWorkspaceExecution(
  runtime: LocalWorkspaceRuntime,
  cfg: SpawnerConfig,
  req: ExecuteRequest,
  opts: ExecuteOptions,
): Promise<ExecuteResponse> {
  // The dispatcher (spawn.ts) already validates this; re-checking here narrows
  // `req.language` to the three runtimes `LaunchSpec` accepts (bash is never
  // launched) and keeps this entry point safe to call on its own.
  if (
    req.language !== 'python' &&
    req.language !== 'node' &&
    req.language !== 'polyglot'
  ) {
    return makeError('SPAWNER_UNAVAILABLE', 'invalid language', 0);
  }
  // The dispatcher validates this too, but the id feeds join() + rm -rf via
  // createWorkspace — keep this entry point safe to call on its own.
  if (!ID_ALPHABET_RE.test(req.executionId)) {
    return makeError('SPAWNER_UNAVAILABLE', 'invalid executionId', 0);
  }

  const timeoutMs = Math.min(
    Math.max(req.timeoutMs ?? cfg.defaultTimeoutMs, 1_000),
    cfg.maxTimeoutMs,
  );
  const startedAtMs = opts.startedAtMs;

  let workspace: Workspace | undefined;
  let running: RunningExecution | undefined;
  try {
    // `ws` is the non-undefined handle used throughout the body; `workspace`
    // (the outer `let`) exists only so the finally block can tear it down.
    const ws = await runtime.createWorkspace(req.executionId);
    workspace = ws;
    const cache = await runtime.ensureCacheStore(req.organizationId);
    const stageStartedAt = Date.now();
    const stageResult = await stageWorkspace(ws.localRoot, req);
    // Backend-specific: docker chowns the bind-mount tree to the runtime uid;
    // k8s is a no-op (the holder re-owns on tar-in). Kept inside the stage
    // timing for parity with the prior inline chown.
    await ws.finalizeStaging();
    const stageMs = Date.now() - stageStartedAt;
    // Captured here for inclusion in ExecuteResponse.priorStage. Undefined
    // when the request had no priorOutputDownloads (nothing to attest).
    const priorStage = stageResult.priorStage;

    // Resolve the path the runtime entrypoint will exec().
    //   - steps[] → the spawner-generated wrapper under /user/.runtime/tale/
    //     (polyglot also routes through runner.py — Python is the image's
    //     base layer and always available as the dispatcher host).
    //   - single-script → the user file at its declared relative path
    // The validator guarantees `entryPath` is defined whenever `steps` is
    // not (and that polyglot always uses steps mode). The entrypoint
    // reattaches /user/code/ for relative paths.
    const entryPath =
      req.steps !== undefined
        ? // validate-request guarantees req.language !== 'bash' here.
          `/user/.runtime/tale/${
            req.language === 'python' || req.language === 'polyglot'
              ? 'runner.py'
              : 'runner.js'
          }`
        : // oxlint-disable-next-line typescript/no-non-null-assertion -- validator enforces mutex (entryPath xor steps)
          req.entryPath!;

    const launched = await runtime.launch(
      {
        executionId: req.executionId,
        organizationId: req.organizationId,
        language: req.language,
        timeoutMs,
        startedAtMs,
        entryPath,
        workspace: ws,
      },
      cache,
    );
    running = launched;

    // Two-tier timeout — both tiers are enforced inside
    // RunningExecution.wait():
    //   - Inner: at `timeoutMs`, SIGKILL the runtime so user code cannot
    //     exceed the cap. The runtime is untrusted; there's no graceful
    //     shutdown contract to honor with SIGTERM, and SIGTERM-then-wait
    //     would just let a misbehaving process burn additional wall-clock
    //     before we force the kill anyway.
    //   - Outer (RunOptions.outerTimeoutMs = `timeoutMs + 30_000`): kill the
    //     launch mechanism itself (e.g. a wedged docker CLI) if it hangs past
    //     the inner kill.
    // Live-progress scanner: parses PHASE markers off the runtime's stdout and
    // forwards the live stdout/stderr tail (byte-capped). The canonical full
    // stdout/stderr still rides `result` below; this only drives SSE deltas.
    const scanner = createStreamScanner(
      {
        ...(opts.onPhase && { onPhase: opts.onPhase }),
        ...(opts.onStdoutDelta && { onStdoutDelta: opts.onStdoutDelta }),
        ...(opts.onStderrDelta && { onStderrDelta: opts.onStderrDelta }),
      },
      {
        stdoutMaxBytes: cfg.stdoutMaxBytes,
        stderrMaxBytes: cfg.stderrMaxBytes,
      },
    );
    // Capture here (container already running) so executeMs excludes staging
    // time. Aligns with the k8s path where runner-started-at is written just
    // before the runtime entrypoint starts.
    const runStartedAtMs = Date.now();
    const result: RunResult = await launched.wait({
      outerTimeoutMs: timeoutMs + 30_000,
      signal: opts.signal,
      // In-band byte caps prevent a runaway runtime from OOM'ing the
      // spawner heap; the backend continues draining the stream but
      // discards bytes past the cap (audit finding R2-B2).
      stdoutMaxBytes: cfg.stdoutMaxBytes,
      stderrMaxBytes: cfg.stderrMaxBytes,
      ...(scanner.onStdoutChunk && { onStdoutChunk: scanner.onStdoutChunk }),
      ...(scanner.onStderrChunk && { onStderrChunk: scanner.onStderrChunk }),
    });
    scanner.finalize();

    const runEndedAtMs = Date.now();
    const durationMs = runEndedAtMs - startedAtMs;
    const executeMs = Math.max(0, runEndedAtMs - runStartedAtMs);
    const exitCode = result.exitCode;

    const stdoutWithoutPhases = stripPhaseMarkers(result.stdout);
    const stdoutClean = stripControlChars(stdoutWithoutPhases);
    const stderrClean = stripControlChars(result.stderr);
    // The backend caps reads in-band, but keep capText as a defensive
    // safety net (no-op when within bounds) and OR truncation flags so
    // either signal surfaces on the wire.
    const { text: stdoutCapped, truncated: stdoutCapPostTrunc } = capText(
      stdoutClean,
      cfg.stdoutMaxBytes,
    );
    const { text: stderrCapped, truncated: stderrCapPostTrunc } = capText(
      stderrClean,
      cfg.stderrMaxBytes,
    );
    const stdoutTrunc = result.stdoutTruncated || stdoutCapPostTrunc;
    const stderrTrunc = result.stderrTruncated || stderrCapPostTrunc;

    // Always attempt to load per-step results when the request was multi-
    // step. The wrapper flushes after every step (and again on fail-fast),
    // so even cancelled / failed runs usually have a partial results.json
    // worth surfacing. `null` means the wrapper never got far enough — we
    // synthesize all-'skipped' entries so the caller doesn't have to
    // special-case the missing-file path.
    const stepResults =
      req.steps !== undefined
        ? ((await readStepResults(ws.localRoot, req.steps)) ??
          synthesizeStepResults(req.steps))
        : undefined;

    // Harvest `/user/output/` unconditionally — even on failure or
    // cancellation, any partial files the user script managed to write
    // before crashing are worth surfacing (resolves D5 in plan
    // llm-majestic-hamming.md). The presigned-URL upload happens inside
    // harvestOutputDir; failures are accumulated rather than thrown so a
    // network blip on one file doesn't lose the others.
    let harvestedFiles: OutputFile[] = [];
    let harvestTruncatedCount = 0;
    let harvestUploadStats: UploadStats = {
      attempted: 0,
      succeeded: 0,
      failures: [],
    };
    let harvestQuotaExhausted = false;
    let harvestUploadFailed = false;
    let harvestReportFailed = false;
    let harvestReadFailed = false;
    let uploadMs = 0;
    const harvestStartedAt = Date.now();
    try {
      const harvested = await harvestOutputDir(
        ws.localRoot,
        {
          perFileMax: cfg.outputFileMaxBytes,
          totalMax: cfg.outputTotalMaxBytes,
        },
        req.outputUploadSlots,
        {
          outputUrlEndpoint: req.outputUrlEndpoint,
          reportUploadedEndpoint: req.reportUploadedEndpoint,
        },
        req.executionId,
        cfg.sandboxToken,
      );
      harvestedFiles = harvested.files;
      harvestTruncatedCount = harvested.truncatedCount;
      harvestUploadStats = harvested.uploadStats;
      harvestQuotaExhausted = harvested.quotaExhausted;
      harvestUploadFailed = harvested.uploadFailed;
      harvestReportFailed = harvested.reportFailed;
      harvestReadFailed = harvested.readFailed;
      uploadMs = harvested.uploadMs;
    } catch (err) {
      console.warn(`[sandbox.harvest] best-effort harvest failed:`, err);
      harvestReadFailed = true;
    }
    const harvestMs = Date.now() - harvestStartedAt;

    // Every terminal shape routes through the shared constructors in
    // exec-response.ts — the cross-backend contract (see the outcome table on
    // ExecutionBackend.execute).
    const parts: ResponseParts = {
      stdoutCapped,
      stderrCapped,
      stdoutTruncated: stdoutTrunc,
      stderrTruncated: stderrTrunc,
      durationMs,
      truncatedFiles: harvestTruncatedCount,
      outputFiles: harvestedFiles,
      ...(stepResults !== undefined && { steps: stepResults }),
      uploadStats: harvestUploadStats,
      timing: {
        stageMs,
        executeMs,
        harvestMs,
        uploadMs,
      },
      ...(priorStage !== undefined && { priorStage }),
    };

    if (opts.signal.aborted) {
      return buildCancelled(parts);
    }

    if (exitCode === 0) {
      return buildCompleted(
        parts,
        classifyHarvestError({
          quotaExhausted: harvestQuotaExhausted,
          uploadFailed: harvestUploadFailed,
          reportFailed: harvestReportFailed,
          readFailed: harvestReadFailed,
        }),
      );
    }

    // A daemon/CLI failure surfaces as the `docker run` exit code and would
    // otherwise classify as user-blaming RUNTIME_ERROR ("User code exited
    // with status 125") — or even EGRESS_DENIED via the daemon's "connection
    // refused" text. Require the docker-CLI stderr signature so a user
    // process that exits 125 stays a runtime failure.
    if (
      DOCKER_INFRA_EXITS.has(exitCode) &&
      DOCKER_INFRA_STDERR_RE.test(stderrCapped)
    ) {
      return buildInfraFailure(
        parts,
        `docker failed to run the execution (exit ${exitCode}): ${stderrCapped.slice(0, 500)}`,
      );
    }

    return buildRuntimeFailure(parts, exitCode, stderrCapped);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return makeError(
      'SPAWNER_UNAVAILABLE',
      `spawner internal error: ${message}`,
      Date.now() - startedAtMs,
    );
  } finally {
    // Tear down the runtime (docker rm / Pod delete) then the workspace
    // (rm -rf the host session dir). Both swallow-and-log internally so a
    // cleanup failure can't mask the real result. `running` is undefined if
    // launch() never happened (e.g. staging threw); `workspace` is undefined
    // only if createWorkspace() itself threw.
    if (running !== undefined) await running.remove();
    if (workspace !== undefined) await workspace.destroy();
  }
}
