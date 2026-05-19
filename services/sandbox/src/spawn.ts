// Per-call execution pipeline. The route handler in server.ts hands a typed
// ExecuteRequest in; this module owns the docker lifecycle and returns a typed
// ExecuteResponse out.

import { buildDockerRunArgs } from './docker_args.ts';
import { runDocker, dockerKill } from './spawn_util.ts';
import type {
  ErrorCode,
  ExecuteRequest,
  ExecuteResponse,
  SpawnerConfig,
} from './types.ts';
import {
  createWorkspaceVolume,
  ensureCacheVolume,
  harvestOutput,
  npmCacheVolumeName,
  pipCacheVolumeName,
  removeVolume,
  stageCodeIntoVolume,
  workspaceVolumeName,
} from './volume.ts';

const PHASE_INSTALL = 'PHASE: installing';
const PHASE_RUN = 'PHASE: running';

interface InFlight {
  containerName: string;
  workspaceVolume: string;
  abort: AbortController;
}

const inFlight = new Map<string, InFlight>();

export function isInFlight(executionId: string): boolean {
  return inFlight.has(executionId);
}

/**
 * Cancel an in-flight execution. Best-effort: docker kill + (cleanup will
 * happen in the originating execute() finally block).
 */
export async function cancelExecution(executionId: string): Promise<boolean> {
  const entry = inFlight.get(executionId);
  if (!entry) return false;
  entry.abort.abort('cancelled by client');
  await dockerKill(entry.containerName);
  return true;
}

export async function executeRequest(
  cfg: SpawnerConfig,
  req: ExecuteRequest,
): Promise<ExecuteResponse> {
  if (!/^[a-f0-9-]{1,64}$/i.test(req.executionId)) {
    return makeError('SPAWNER_UNAVAILABLE', 'invalid executionId', 0);
  }
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(req.organizationId)) {
    return makeError('SPAWNER_UNAVAILABLE', 'invalid organizationId', 0);
  }
  if (req.language !== 'python' && req.language !== 'node') {
    return makeError('SPAWNER_UNAVAILABLE', 'invalid language', 0);
  }

  const timeoutMs = Math.min(
    Math.max(req.timeoutMs ?? cfg.defaultTimeoutMs, 1_000),
    cfg.maxTimeoutMs,
  );
  const startedAtMs = Date.now();
  const containerName = `tale-sbx-${req.executionId}`;
  const workspaceVolume = workspaceVolumeName(req.executionId);
  const pipVolume = pipCacheVolumeName(cfg, req.organizationId);
  const npmVolume = npmCacheVolumeName(cfg, req.organizationId);

  const abort = new AbortController();
  inFlight.set(req.executionId, {
    containerName,
    workspaceVolume,
    abort,
  });

  try {
    await createWorkspaceVolume(req.executionId);
    await ensureCacheVolume(pipVolume);
    await ensureCacheVolume(npmVolume);

    await stageCodeIntoVolume({
      volumeName: workspaceVolume,
      language: req.language,
      code: req.code,
      packages: req.packages ?? [],
      options: req.options ?? {},
      inputFiles: req.inputFiles ?? [],
    });

    const argv = buildDockerRunArgs(cfg, {
      executionId: req.executionId,
      organizationId: req.organizationId,
      language: req.language,
      timeoutMs,
      workspaceVolume,
      pipCacheVolume: pipVolume,
      npmCacheVolume: npmVolume,
      startedAtMs,
    });

    const result = await runDocker(argv, {
      timeoutMs: timeoutMs + 30_000,
      signal: abort.signal,
    });

    const durationMs = Date.now() - startedAtMs;
    const phases = classifyPhases(result.stdout);
    const exitCode = result.exitCode;

    // Cap stdout/stderr per config.
    const { text: stdoutCapped, truncated: stdoutTrunc } = capText(
      stripPhaseMarkers(result.stdout),
      cfg.stdoutMaxBytes,
    );
    const { text: stderrCapped, truncated: stderrTrunc } = capText(
      result.stderr,
      cfg.stderrMaxBytes,
    );

    // Cancellation took precedence (we set abort and killed): if signal is
    // aborted, surface as 'cancelled' regardless of exit code.
    if (abort.signal.aborted) {
      return {
        status: 'cancelled',
        exitCode: null,
        errorCode: 'CANCELLED',
        errorMessage: 'Execution cancelled by client',
        stdoutBase64: Buffer.from(stdoutCapped).toString('base64'),
        stderrBase64: Buffer.from(stderrCapped).toString('base64'),
        durationMs,
        installMs: phases.installMs,
        runMs: phases.runMs,
        truncated: { stdout: stdoutTrunc, stderr: stderrTrunc, files: 0 },
        outputFiles: [],
      };
    }

    // Map exit codes (per runtime-image entrypoint convention):
    //   0   = success
    //   64  = install failed (INSTALL_FAILED or PACKAGE_NOT_FOUND)
    //   65  = bad invocation (SPAWNER_UNAVAILABLE)
    //   124 = docker wrapper timeout (TIMEOUT)
    //   137 = SIGKILL (could be OOM kill OR our explicit timeout kill)
    //   139 = segfault
    //   else = user code RUNTIME_ERROR
    if (exitCode === 0) {
      const harvested = await harvestOutput(workspaceVolume, {
        perFileMax: cfg.outputFileMaxBytes,
        totalMax: cfg.outputTotalMaxBytes,
      });
      return {
        status: 'completed',
        exitCode: 0,
        stdoutBase64: Buffer.from(stdoutCapped).toString('base64'),
        stderrBase64: Buffer.from(stderrCapped).toString('base64'),
        durationMs,
        installMs: phases.installMs,
        runMs: phases.runMs,
        truncated: {
          stdout: stdoutTrunc,
          stderr: stderrTrunc,
          files: harvested.truncatedCount,
        },
        outputFiles: harvested.files,
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
      installMs: phases.installMs,
      runMs: phases.runMs,
      truncated: { stdout: stdoutTrunc, stderr: stderrTrunc, files: 0 },
      outputFiles: [],
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
    // Best-effort cleanup; named `--rm` should have removed the container,
    // and we tear down the workspace volume.
    await removeVolume(workspaceVolume).catch(() => {});
  }
}

function makeError(
  errorCode: ErrorCode,
  msg: string,
  durationMs: number,
): ExecuteResponse {
  return {
    status: 'failed',
    exitCode: null,
    errorCode,
    errorMessage: msg,
    stdoutBase64: '',
    stderrBase64: '',
    durationMs,
    installMs: null,
    runMs: null,
    truncated: { stdout: false, stderr: false, files: 0 },
    outputFiles: [],
  };
}

function stripPhaseMarkers(stdout: string): string {
  return stdout
    .split('\n')
    .filter((line) => line !== PHASE_INSTALL && line !== PHASE_RUN)
    .join('\n');
}

interface Phases {
  installMs: number | null;
  runMs: number | null;
}

function classifyPhases(_stdout: string): Phases {
  // Phase timing is approximate — the markers tell us the order, but the
  // spawner doesn't have inside-container timestamps. v2 can pipe wall-clock
  // hints in the marker; for v1 we return null timings and report only that
  // markers were observed. Callers should not depend on install/run split.
  return { installMs: null, runMs: null };
}

function capText(
  text: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
  const buf = Buffer.from(text);
  if (buf.byteLength <= maxBytes) return { text, truncated: false };
  return { text: buf.subarray(0, maxBytes).toString('utf8'), truncated: true };
}

function classifyFailure(
  exitCode: number,
  stderr: string,
): { code: ErrorCode; message: string } {
  if (exitCode === 124) {
    return { code: 'TIMEOUT', message: 'Wall-clock timeout exceeded' };
  }
  if (exitCode === 137) {
    // OOM vs explicit kill — Linux doesn't tell us cleanly. If the message
    // mentions "Killed" we lean OOM; otherwise it's likely an explicit timeout.
    if (/killed/i.test(stderr)) {
      return { code: 'OOM', message: 'Container killed (likely OOM)' };
    }
    return { code: 'TIMEOUT', message: 'Container killed (SIGKILL)' };
  }
  if (exitCode === 64) {
    if (/no matching distribution|could not find a version/i.test(stderr)) {
      return {
        code: 'PACKAGE_NOT_FOUND',
        message: 'Requested package could not be resolved',
      };
    }
    if (/proxy|forbidden|filter|403|connection refused/i.test(stderr)) {
      return {
        code: 'EGRESS_DENIED',
        message: 'Egress proxy denied the request',
      };
    }
    return {
      code: 'INSTALL_FAILED',
      message: 'Package install failed',
    };
  }
  if (exitCode === 65) {
    return {
      code: 'SPAWNER_UNAVAILABLE',
      message: 'Sandbox runtime rejected the invocation',
    };
  }
  return {
    code: 'RUNTIME_ERROR',
    message: `User code exited with status ${exitCode}`,
  };
}
