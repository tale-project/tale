// Per-call execution pipeline. The route handler in server.ts hands a typed
// ExecuteRequest in; this module owns the docker lifecycle and returns a
// typed ExecuteResponse out.
//
// Flow:
//   1. Ensure per-org pip/npm cache volumes exist (one-shot chown so the
//      unprivileged runtime user can write).
//   2. Create host workspace dir at /var/lib/tale-sandbox/sessions/<uuid>/
//      and stage code/ + input/ via Bun fs (the spawner sees this path
//      directly because it's bind-mounted 1:1 into the container).
//   3. `docker run` the runtime with --mount type=bind workspaceHostDir
//      → /workspace.
//   4. Wait with host-side wall-clock timeout.
//   5. Read /workspace/output/ back via Bun fs.
//   6. Capture stdout/stderr; classify exit code → errorCode.
//   7. `docker rm -f` + rm -rf the host dir.

import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
  chown,
} from 'node:fs/promises';
import { join } from 'node:path';

import { buildDockerRunArgs } from './docker_args.ts';
import { runDocker, dockerKill, dockerRm } from './spawn_util.ts';
import type {
  ErrorCode,
  ExecuteRequest,
  ExecuteResponse,
  OutputFile,
  SpawnerConfig,
} from './types.ts';
import {
  ensureCacheVolume,
  npmCacheVolumeName,
  pipCacheVolumeName,
} from './volume.ts';

const PHASE_INSTALL = 'PHASE: installing';
const PHASE_RUN = 'PHASE: running';
const NAME_RE = /^[a-zA-Z0-9._-]+$/;
const RUNTIME_UID = 65534;
const RUNTIME_GID = 65534;

interface InFlight {
  containerName: string;
  abort: AbortController;
}

const inFlight = new Map<string, InFlight>();

export function isInFlight(executionId: string): boolean {
  return inFlight.has(executionId);
}

export async function cancelExecution(executionId: string): Promise<boolean> {
  const entry = inFlight.get(executionId);
  if (!entry) return false;
  entry.abort.abort('cancelled by client');
  await dockerKill(entry.containerName);
  return true;
}

async function stageWorkspace(
  hostDir: string,
  req: ExecuteRequest,
): Promise<void> {
  const codeDir = join(hostDir, 'code');
  const inputDir = join(hostDir, 'input');
  const outputDir = join(hostDir, 'output');
  await mkdir(codeDir, { recursive: true });
  await mkdir(inputDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });

  const mainName = req.language === 'python' ? 'main.py' : 'main.js';
  await writeFile(join(codeDir, mainName), req.code);
  await writeFile(
    join(codeDir, 'packages.json'),
    JSON.stringify(req.packages ?? []),
  );
  await writeFile(
    join(codeDir, 'options.json'),
    JSON.stringify(req.options ?? {}),
  );

  for (const f of req.inputFiles ?? []) {
    if (!NAME_RE.test(f.name)) {
      throw new Error(`unsafe input file name: ${JSON.stringify(f.name)}`);
    }
    const bytes = Buffer.from(f.contentBase64, 'base64');
    await writeFile(join(inputDir, f.name), bytes);
  }

  // Spawner runs as root; the runtime container runs as nobody (65534) and
  // needs to read the staged files. Recursively chown.
  await chownRecursive(hostDir, RUNTIME_UID, RUNTIME_GID);
}

async function chownRecursive(
  path: string,
  uid: number,
  gid: number,
): Promise<void> {
  await chown(path, uid, gid);
  const entries = await readdir(path, { withFileTypes: true });
  for (const e of entries) {
    const p = join(path, e.name);
    if (e.isDirectory()) {
      await chownRecursive(p, uid, gid);
    } else {
      await chown(p, uid, gid);
    }
  }
}

async function harvestOutputDir(
  hostDir: string,
  caps: { perFileMax: number; totalMax: number },
): Promise<{ files: OutputFile[]; truncatedCount: number }> {
  const outputDir = join(hostDir, 'output');
  const files: OutputFile[] = [];
  let truncatedCount = 0;
  let totalAccepted = 0;

  async function walk(rel: string): Promise<void> {
    const abs = join(outputDir, rel);
    let entries;
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      const childAbs = join(outputDir, childRel);
      if (e.isDirectory()) {
        await walk(childRel);
        continue;
      }
      if (!e.isFile()) continue;
      const st = await stat(childAbs);
      if (
        st.size > caps.perFileMax ||
        totalAccepted + st.size > caps.totalMax
      ) {
        truncatedCount += 1;
        continue;
      }
      const bytes = await readFile(childAbs);
      files.push({
        name: childRel,
        contentBase64: bytes.toString('base64'),
        size: st.size,
        contentType: guessContentType(childRel),
      });
      totalAccepted += st.size;
    }
  }
  await walk('');
  return { files, truncatedCount };
}

function guessContentType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pptx'))
    return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.xlsx'))
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.docx'))
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.csv')) return 'text/csv; charset=utf-8';
  if (lower.endsWith('.txt') || lower.endsWith('.log'))
    return 'text/plain; charset=utf-8';
  if (lower.endsWith('.html')) return 'text/html; charset=utf-8';
  return 'application/octet-stream';
}

/**
 * Phase events emitted while the runtime container is running. The server's
 * SSE handler relays these to the convex action; the action then writes the
 * artifact row's `runStatus` + `runProgress` so the canvas shows live
 * progress instead of a frozen spinner (Refinement 2).
 */
export type PhaseEvent = { phase: 'installing' } | { phase: 'running' };

export interface ExecuteRequestOptions {
  onPhase?: (event: PhaseEvent) => void;
}

export async function executeRequest(
  cfg: SpawnerConfig,
  req: ExecuteRequest,
  opts: ExecuteRequestOptions = {},
): Promise<ExecuteResponse> {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(req.executionId)) {
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
  const pipVolume = pipCacheVolumeName(cfg, req.organizationId);
  const npmVolume = npmCacheVolumeName(cfg, req.organizationId);
  const workspaceHostDir = join(cfg.hostSessionRoot, req.executionId);

  const abort = new AbortController();
  inFlight.set(req.executionId, { containerName, abort });

  try {
    await ensureCacheVolume(pipVolume);
    await ensureCacheVolume(npmVolume);
    await stageWorkspace(workspaceHostDir, req);

    const argv = buildDockerRunArgs(cfg, {
      executionId: req.executionId,
      organizationId: req.organizationId,
      language: req.language,
      timeoutMs,
      pipCacheVolume: pipVolume,
      npmCacheVolume: npmVolume,
      workspaceHostDir,
      startedAtMs,
    });

    // Two-tier timeout:
    //   - Inner: at `timeoutMs`, docker kill the container so user code
    //     cannot exceed the cap.
    //   - Outer (in runDocker): at `timeoutMs + 30_000`, kill the docker
    //     CLI process too — covers the case where `docker kill` itself
    //     hangs (rare; would mean the daemon is in trouble).
    const killTimer = setTimeout(() => {
      void dockerKill(containerName).catch(() => {});
    }, timeoutMs);
    let result: Awaited<ReturnType<typeof runDocker>>;
    try {
      // Line-buffered phase parser. The runtime image's entrypoint emits
      // "PHASE: installing\n" then later "PHASE: running\n" on stdout. We
      // accumulate bytes until we see a newline, then scan each line for
      // those markers and fire the onPhase callback. Other lines (user's
      // own prints) are ignored — the full stdout is still captured in
      // result.stdout for the final response.
      let lineBuf = '';
      const decoder = new TextDecoder('utf-8', { fatal: false });
      const onChunk = opts.onPhase
        ? (chunk: Uint8Array) => {
            lineBuf += decoder.decode(chunk, { stream: true });
            let nl: number;
            while ((nl = lineBuf.indexOf('\n')) !== -1) {
              const line = lineBuf.slice(0, nl);
              lineBuf = lineBuf.slice(nl + 1);
              if (line === PHASE_INSTALL) {
                opts.onPhase?.({ phase: 'installing' });
              } else if (line === PHASE_RUN) {
                opts.onPhase?.({ phase: 'running' });
              }
            }
          }
        : undefined;
      result = await runDocker(argv, {
        timeoutMs: timeoutMs + 30_000,
        signal: abort.signal,
        killOnTimeoutContainer: containerName,
        ...(onChunk && { onStdoutChunk: onChunk }),
      });
    } finally {
      clearTimeout(killTimer);
    }

    const durationMs = Date.now() - startedAtMs;
    const phases = classifyPhases(result.stdout);
    const exitCode = result.exitCode;

    const stdoutWithoutPhases = stripPhaseMarkers(result.stdout);
    const { text: stdoutCapped, truncated: stdoutTrunc } = capText(
      stdoutWithoutPhases,
      cfg.stdoutMaxBytes,
    );
    const { text: stderrCapped, truncated: stderrTrunc } = capText(
      result.stderr,
      cfg.stderrMaxBytes,
    );

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

    if (exitCode === 0) {
      const harvested = await harvestOutputDir(workspaceHostDir, {
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
    await dockerRm(containerName).catch(() => {});
    await rm(workspaceHostDir, { recursive: true, force: true }).catch(
      () => {},
    );
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
  // Phase timing is approximate. v2 can pipe wall-clock hints in the marker.
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

const EGRESS_DENIED_RE =
  /403 Filtered|Tunnel connection failed|ProxyError|connection refused/i;
const PACKAGE_NOT_FOUND_RE =
  /no matching distribution|could not find a version|unsatisfiable|404 Not Found|E404|No matching distribution found/i;

function classifyFailure(
  exitCode: number,
  stderr: string,
): { code: ErrorCode; message: string } {
  if (exitCode === 124) {
    return { code: 'TIMEOUT', message: 'Wall-clock timeout exceeded' };
  }
  if (exitCode === 137) {
    if (/killed/i.test(stderr)) {
      return { code: 'OOM', message: 'Container killed (likely OOM)' };
    }
    return { code: 'TIMEOUT', message: 'Container killed (SIGKILL)' };
  }
  if (exitCode === 64) {
    if (PACKAGE_NOT_FOUND_RE.test(stderr)) {
      return {
        code: 'PACKAGE_NOT_FOUND',
        message: 'Requested package could not be resolved',
      };
    }
    if (EGRESS_DENIED_RE.test(stderr)) {
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
  // Non-zero from user code or runtime crash — but if stderr clearly shows the
  // egress proxy blocked the call, prefer EGRESS_DENIED over a generic
  // RUNTIME_ERROR so the LLM knows it's a network policy, not a code bug.
  if (EGRESS_DENIED_RE.test(stderr)) {
    return {
      code: 'EGRESS_DENIED',
      message: 'Egress proxy denied the request',
    };
  }
  return {
    code: 'RUNTIME_ERROR',
    message: `User code exited with status ${exitCode}`,
  };
}
