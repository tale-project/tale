// Per-call execution orchestration. The route handler in server.ts hands a
// typed ExecuteRequest in; this module owns the in-flight registry + the
// backend-agnostic orchestration (stage → run → stream → harvest → response)
// and returns a typed ExecuteResponse out. The runtime itself (`docker run`
// today, a Kubernetes Pod under SANDBOX_BACKEND=kubernetes) is launched through
// the injected ExecutionBackend (see backend/types.ts); this module never
// touches docker directly. The pure + staging/harvest helpers live in
// exec-common.ts (shared with the k8s in-Pod stage/harvest modes).

import type {
  ExecutionBackend,
  RunningExecution,
  RunResult,
  Workspace,
} from './backend/types.ts';
import {
  capText,
  classifyFailure,
  harvestOutputDir,
  makeError,
  PHASE_INSTALL,
  PHASE_RUN,
  readStepResults,
  stageWorkspace,
  stripControlChars,
  stripPhaseMarkers,
  synthesizeStepResults,
} from './exec-common.ts';
import type {
  ErrorCode,
  ExecuteRequest,
  ExecuteResponse,
  OutputFile,
  SpawnerConfig,
  UploadStats,
} from './types.ts';
import {
  ID_ALPHABET_RE,
  ORG_ID_ALPHABET_RE,
  type SandboxPhaseEvent,
} from './wire.ts';

interface InFlight {
  abort: AbortController;
  startedAt: number;
}

const inFlight = new Map<string, InFlight>();

export function isInFlight(executionId: string): boolean {
  return inFlight.has(executionId);
}

export function inFlightSize(): number {
  return inFlight.size;
}

export function inFlightIds(): string[] {
  return Array.from(inFlight.keys());
}

/**
 * Pre-registers an id when the HTTP handler accepts a request but before
 * `executeRequest` has constructed the real InFlight entry. The placeholder
 * is overwritten in executeRequest; `unregisterInFlight` is a no-op once the
 * real entry has been removed by executeRequest's own finally block.
 */
export function registerInFlight(executionId: string): void {
  if (inFlight.has(executionId)) return;
  // Placeholder until executeRequest swaps in the real entry. The
  // AbortController exists so an early cancelExecution call sees a real
  // signal-bearing object.
  inFlight.set(executionId, {
    abort: new AbortController(),
    startedAt: Date.now(),
  });
}

export function unregisterInFlight(executionId: string): void {
  inFlight.delete(executionId);
}

export async function cancelExecution(
  backend: ExecutionBackend,
  executionId: string,
): Promise<boolean> {
  const entry = inFlight.get(executionId);
  if (!entry) return false;
  // The abort signal is the primary cancel — it ends the runtime stream that
  // `RunningExecution.wait()` is draining, so `executeRequest` proceeds to its
  // finally block. The backend additionally kills the container/Pod (the
  // TERM→KILL escalation + wedged-daemon ceiling live inside the backend,
  // which addresses the runtime by execution id rather than a stored handle —
  // so this works even before `launch()` has created it).
  entry.abort.abort('cancelled by client');
  await backend.cancel(executionId);
  return true;
}

/**
 * Phase events emitted while the runtime container is running. The server's
 * SSE handler relays these to the convex action; the action then writes the
 * artifact row's `runStatus` + `runProgress` so the canvas shows live
 * progress instead of a frozen spinner.
 *
 * Shape mirrors `services/platform/convex/sandbox/wire.ts:sandboxPhaseEventLiterals`.
 */
type PhaseEvent = { phase: SandboxPhaseEvent };

interface ExecuteRequestOptions {
  onPhase?: (event: PhaseEvent) => void;
  /**
   * Fires for each non-PHASE-marker line on stdout while the container is
   * alive, after the line has been decoded. The trailing newline IS
   * included so consumers can append directly to a tail buffer without
   * re-inserting separators. On stream EOF a final residual non-empty line
   * (no newline) is also delivered. PHASE markers are stripped from this
   * stream — they only fire `onPhase`. Used by server.ts to emit incremental
   * `event: stdout` SSE deltas; the final `result` event still carries the
   * canonical base64'd buffer.
   */
  onStdoutDelta?: (text: string) => void;
  /**
   * Fires for each decoded stderr chunk while the container is alive. Unlike
   * stdout, stderr is emitted CHUNK-by-chunk (no line buffering) because
   * (a) it carries no PHASE protocol, and (b) Python/Node tend to emit
   * stderr without trailing newlines (progress bars, tracebacks). The
   * platform-side coalescer rate-limits the mutations these deltas trigger.
   */
  onStderrDelta?: (text: string) => void;
}

export async function executeRequest(
  backend: ExecutionBackend,
  cfg: SpawnerConfig,
  req: ExecuteRequest,
  opts: ExecuteRequestOptions = {},
): Promise<ExecuteResponse> {
  if (!ID_ALPHABET_RE.test(req.executionId)) {
    return makeError('SPAWNER_UNAVAILABLE', 'invalid executionId', 0);
  }
  if (!ORG_ID_ALPHABET_RE.test(req.organizationId)) {
    return makeError('SPAWNER_UNAVAILABLE', 'invalid organizationId', 0);
  }
  if (
    req.language !== 'python' &&
    req.language !== 'node' &&
    req.language !== 'polyglot'
  ) {
    return makeError('SPAWNER_UNAVAILABLE', 'invalid language', 0);
  }

  const timeoutMs = Math.min(
    Math.max(req.timeoutMs ?? cfg.defaultTimeoutMs, 1_000),
    cfg.maxTimeoutMs,
  );
  const startedAtMs = Date.now();

  // Reuse the placeholder AbortController if the server pre-registered one
  // when the request landed. A `cancelExecution` call between registerInFlight
  // and this line targets the placeholder's signal — discarding it here and
  // building a fresh controller would leak that early abort, leaving the
  // runtime running until the watchdog timeout. Reusing the entry preserves
  // the (already-aborted, if cancelled) signal.
  const placeholder = inFlight.get(req.executionId);
  const abort = placeholder?.abort ?? new AbortController();
  inFlight.set(req.executionId, {
    abort,
    startedAt: startedAtMs,
  });

  let workspace: Workspace | undefined;
  let running: RunningExecution | undefined;
  try {
    // `ws` is the non-undefined handle used throughout the body; `workspace`
    // (the outer `let`) exists only so the finally block can tear it down.
    const ws = await backend.createWorkspace(req.executionId);
    workspace = ws;
    const cache = await backend.ensureCacheStore(req.organizationId);
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
    //   - steps[] → the spawner-generated wrapper under /workspace/.tale/
    //     (polyglot also routes through runner.py — Python is the image's
    //     base layer and always available as the dispatcher host).
    //   - single-script → the user file at its declared relative path
    // The validator guarantees `entryPath` is defined whenever `steps` is
    // not (and that polyglot always uses steps mode). The entrypoint
    // reattaches /workspace/code/ for relative paths.
    const entryPath =
      req.steps !== undefined
        ? // validate-request guarantees req.language !== 'bash' here.
          `/workspace/.tale/${
            req.language === 'python' || req.language === 'polyglot'
              ? 'runner.py'
              : 'runner.js'
          }`
        : // oxlint-disable-next-line typescript/no-non-null-assertion -- validator enforces mutex (entryPath xor steps)
          req.entryPath!;

    const launched = await backend.launch(
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
    let result: RunResult;
    // Block scope for the phase-marker parser state (lineBuf, decoders).
    {
      // Line-buffered phase parser. The runtime image's entrypoint emits
      // "PHASE: installing\n" then later "PHASE: running\n" on stdout. We
      // accumulate bytes until we see a newline, then scan each line for
      // those markers and fire the onPhase callback. Other lines (user's
      // own prints) are ignored — the full stdout is still captured in
      // result.stdout for the final response.
      //
      // On stream EOF without a trailing newline, the residual `lineBuf` is
      // drained once via `finalize` so the last marker still produces an
      // event (audit finding R2-3 C3 partial). `stripPhaseMarkers` below
      // also handles the unterminated case via `split('\n')`.
      let lineBuf = '';
      // Hard cap on lineBuf so a runtime that emits no newlines (a single
      // multi-GB "log line") cannot grow the spawner heap. On overflow we
      // flush the buffered prefix as a synthetic line and reset — the
      // PHASE markers are short, so they're never inside such a blast.
      const MAX_LINE_BUF_BYTES = 64 * 1024;
      // Live-tail delta byte caps mirror `stdoutMaxBytes`/`stderrMaxBytes`
      // (which only bound the spawner's buffered output). Without these
      // caps `onStdoutDelta`/`onStderrDelta` would forward unbounded
      // bytes to the SSE consumer even after truncation kicks in.
      let stdoutDeltaBytes = 0;
      let stderrDeltaBytes = 0;
      const decoder = new TextDecoder('utf-8', { fatal: false });
      const stderrDecoder = new TextDecoder('utf-8', { fatal: false });
      // PHASE-marker lines are stripped from the live tail (`onStdoutDelta`)
      // so the user doesn't briefly see `PHASE: installing` in the canvas.
      // Non-marker lines are forwarded WITH their trailing newline so the
      // platform-side append produces a faithful tail.
      const handleStdoutLine = (line: string) => {
        if (line === PHASE_INSTALL) {
          opts.onPhase?.({ phase: 'installing' });
        } else if (line === PHASE_RUN) {
          opts.onPhase?.({ phase: 'running' });
        } else if (
          opts.onStdoutDelta &&
          stdoutDeltaBytes < cfg.stdoutMaxBytes
        ) {
          const payload = `${line}\n`;
          stdoutDeltaBytes += payload.length;
          opts.onStdoutDelta(payload);
        }
      };
      const wantStdoutScan = Boolean(opts.onPhase || opts.onStdoutDelta);
      const onStdoutChunk = wantStdoutScan
        ? (chunk: Uint8Array) => {
            lineBuf += decoder.decode(chunk, { stream: true });
            // Flush any newline-delimited prefixes first so partial markers
            // at the seam don't get clipped.
            let nl: number;
            while ((nl = lineBuf.indexOf('\n')) !== -1) {
              const line = lineBuf.slice(0, nl);
              lineBuf = lineBuf.slice(nl + 1);
              handleStdoutLine(line);
            }
            // No-newline blast guard: if we still have a large pending
            // buffer with no terminator, flush its prefix as a synthetic
            // line so heap doesn't grow unbounded.
            if (lineBuf.length > MAX_LINE_BUF_BYTES) {
              const synthetic = lineBuf.slice(0, MAX_LINE_BUF_BYTES);
              lineBuf = lineBuf.slice(MAX_LINE_BUF_BYTES);
              handleStdoutLine(synthetic);
            }
          }
        : undefined;
      const onStderrChunk = opts.onStderrDelta
        ? (chunk: Uint8Array) => {
            if (stderrDeltaBytes >= cfg.stderrMaxBytes) return;
            const text = stderrDecoder.decode(chunk, { stream: true });
            if (text.length === 0) return;
            stderrDeltaBytes += text.length;
            opts.onStderrDelta?.(text);
          }
        : undefined;
      result = await launched.wait({
        outerTimeoutMs: timeoutMs + 30_000,
        signal: abort.signal,
        // In-band byte caps prevent a runaway runtime from OOM'ing the
        // spawner heap; the backend continues draining the stream but
        // discards bytes past the cap (audit finding R2-B2).
        stdoutMaxBytes: cfg.stdoutMaxBytes,
        stderrMaxBytes: cfg.stderrMaxBytes,
        ...(onStdoutChunk && { onStdoutChunk }),
        ...(onStderrChunk && { onStderrChunk }),
      });
      // EOF drain — the line loop above only fires on newlines; a final
      // unterminated line (PHASE marker OR user output) lives in lineBuf.
      if (wantStdoutScan) {
        lineBuf += decoder.decode();
        if (lineBuf.length > 0) {
          if (lineBuf === PHASE_INSTALL) {
            opts.onPhase?.({ phase: 'installing' });
          } else if (lineBuf === PHASE_RUN) {
            opts.onPhase?.({ phase: 'running' });
          } else {
            // Trailing chunk WITHOUT newline — forward verbatim.
            opts.onStdoutDelta?.(lineBuf);
          }
        }
      }
      if (opts.onStderrDelta) {
        const tail = stderrDecoder.decode();
        if (tail.length > 0) opts.onStderrDelta(tail);
      }
    }

    const durationMs = Date.now() - startedAtMs;
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
    // synthesize a [{status:'failed'}] entry so the caller doesn't have to
    // special-case the missing-file path.
    const stepResults =
      req.steps !== undefined
        ? ((await readStepResults(ws.localRoot, req.steps)) ??
          synthesizeStepResults(req.steps))
        : undefined;

    // Harvest `/workspace/output/` unconditionally — even on failure or
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

    // Classify any harvest-side failure into a wire errorCode. Order
    // matters: quota > upload > report > read. The first matching code
    // becomes the response's errorCode IF the user code itself exited 0
    // — we don't want to mask a legitimate runtime crash. For non-zero
    // exits, classifyFailure() picks the runtime errorCode and the upload
    // failure shows up in `uploadStats.failures` instead.
    let harvestErrorCode: ErrorCode | undefined;
    let harvestErrorMessage: string | undefined;
    if (harvestQuotaExhausted) {
      harvestErrorCode = 'UPLOAD_QUOTA_EXCEEDED';
      harvestErrorMessage =
        'Per-run output-file quota exceeded; some files were not uploaded';
    } else if (harvestUploadFailed) {
      harvestErrorCode = 'UPLOAD_FAILED';
      harvestErrorMessage = 'One or more output uploads failed';
    } else if (harvestReportFailed) {
      harvestErrorCode = 'UPLOAD_REPORT_FAILED';
      harvestErrorMessage =
        'Upload succeeded but report-back to platform failed';
    } else if (harvestReadFailed) {
      harvestErrorCode = 'HARVEST_READ_FAILED';
      harvestErrorMessage = "Couldn't read /workspace/output";
    }

    const timing = {
      stageMs,
      executeMs: Math.max(0, durationMs),
      harvestMs,
      uploadMs,
    };

    if (abort.signal.aborted) {
      return {
        status: 'cancelled',
        exitCode: null,
        errorCode: 'CANCELLED',
        errorMessage: 'Execution cancelled by client',
        stdoutBase64: Buffer.from(stdoutCapped).toString('base64'),
        stderrBase64: Buffer.from(stderrCapped).toString('base64'),
        durationMs,
        truncated: {
          stdout: stdoutTrunc,
          stderr: stderrTrunc,
          files: harvestTruncatedCount,
        },
        outputFiles: harvestedFiles,
        ...(stepResults !== undefined && { steps: stepResults }),
        uploadStats: harvestUploadStats,
        timing,
        ...(priorStage !== undefined && { priorStage }),
      };
    }

    if (exitCode === 0) {
      return {
        status: harvestErrorCode !== undefined ? 'failed' : 'completed',
        exitCode: 0,
        ...(harvestErrorCode !== undefined && {
          errorCode: harvestErrorCode,
          ...(harvestErrorMessage !== undefined && {
            errorMessage: harvestErrorMessage,
          }),
        }),
        stdoutBase64: Buffer.from(stdoutCapped).toString('base64'),
        stderrBase64: Buffer.from(stderrCapped).toString('base64'),
        durationMs,
        truncated: {
          stdout: stdoutTrunc,
          stderr: stderrTrunc,
          files: harvestTruncatedCount,
        },
        outputFiles: harvestedFiles,
        ...(stepResults !== undefined && { steps: stepResults }),
        uploadStats: harvestUploadStats,
        timing,
        ...(priorStage !== undefined && { priorStage }),
      };
    }

    const { code: ec, message } = classifyFailure(exitCode, stderrCapped);
    return {
      status: ec === 'CANCELLED' ? 'cancelled' : 'failed',
      exitCode,
      errorCode: ec,
      errorMessage: message,
      stdoutBase64: Buffer.from(stdoutCapped).toString('base64'),
      stderrBase64: Buffer.from(stderrCapped).toString('base64'),
      durationMs,
      truncated: {
        stdout: stdoutTrunc,
        stderr: stderrTrunc,
        files: harvestTruncatedCount,
      },
      outputFiles: harvestedFiles,
      ...(stepResults !== undefined && { steps: stepResults }),
      uploadStats: harvestUploadStats,
      timing,
      ...(priorStage !== undefined && { priorStage }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return makeError(
      'SPAWNER_UNAVAILABLE',
      `spawner internal error: ${message}`,
      Date.now() - startedAtMs,
    );
  } finally {
    inFlight.delete(req.executionId);
    // Tear down the runtime (docker rm / Pod delete) then the workspace
    // (rm -rf the host session dir). Both swallow-and-log internally so a
    // cleanup failure can't mask the real result. `running` is undefined if
    // launch() never happened (e.g. staging threw); `workspace` is undefined
    // only if createWorkspace() itself threw.
    if (running !== undefined) await running.remove();
    if (workspace !== undefined) await workspace.destroy();
  }
}
