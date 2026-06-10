// Backend-agnostic execution helpers, shared by:
//   - DockerBackend.execute (spawner-side stage → run → harvest), and
//   - the in-Pod `stage` / `harvest` entry modes of the KubernetesBackend
//     (which run the spawner image inside the runtime Pod).
//
// Everything here is pure or operates on a LOCAL `/workspace`-shaped directory
// + the presigned-URL callbacks (sandbox-callback.ts). No docker/k8s specifics.

import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import {
  postToUploadSlot,
  reportUploaded,
  requestUploadUrls,
} from './sandbox-callback.ts';
import type {
  ErrorCode,
  ExecuteRequest,
  ExecuteResponse,
  OutputFile,
  PriorStageResult,
  PriorStageSkipReason,
  UploadFailure,
  UploadStats,
} from './types.ts';
import type {
  SandboxPhaseEvent,
  SandboxStepResult,
  SandboxStepStatus,
} from './wire.ts';

// Hidden directory inside /workspace/output/ where the multi-step wrapper
// writes its per-step bookkeeping. The harvest path filters anything under
// this prefix so the bookkeeping never appears in the user-visible output
// file chips.
export const STEPS_INTERNAL_DIR = '.tale-steps';
export const STEPS_RESULTS_FILENAME = 'results.json';

export const PHASE_INSTALL = 'PHASE: installing';
export const PHASE_RUN = 'PHASE: running';

export interface StreamScannerCallbacks {
  /** Fired when a `PHASE: installing` / `PHASE: running` marker line is seen. */
  onPhase?: (event: { phase: SandboxPhaseEvent }) => void;
  /**
   * Fired per non-marker stdout line WITH its trailing newline (live tail).
   * On stream EOF a final residual line without a newline is also delivered.
   */
  onStdoutDelta?: (text: string) => void;
  /** Fired per decoded stderr chunk (no line buffering). */
  onStderrDelta?: (text: string) => void;
}

export interface StreamScanner {
  /** Feed a runtime stdout chunk (drives phase markers + live stdout tail). */
  onStdoutChunk?: (chunk: Uint8Array) => void;
  /** Feed a runtime stderr chunk (live stderr tail). */
  onStderrChunk?: (chunk: Uint8Array) => void;
  /** Drain the residual unterminated line on stream EOF. */
  finalize: () => void;
}

// Hard cap on the stdout line buffer so a runtime that emits no newlines (a
// single multi-GB "log line") can't grow the spawner heap. On overflow the
// buffered prefix is flushed as a synthetic line — PHASE markers are short, so
// they're never inside such a blast.
const MAX_LINE_BUF_BYTES = 64 * 1024;

/**
 * Build the live-progress stream scanner shared by the docker orchestrator and
 * the k8s backend's runner-log follower. Parses `PHASE:` markers off stdout
 * (firing `onPhase`), forwards non-marker stdout lines as a live tail
 * (`onStdoutDelta`, PHASE lines stripped), and forwards stderr chunks
 * (`onStderrDelta`). Live-tail bytes are capped to mirror the buffered output
 * caps. The canonical full stdout/stderr still rides the final response; this
 * is purely for incremental SSE deltas.
 */
export function createStreamScanner(
  cb: StreamScannerCallbacks,
  caps: { stdoutMaxBytes: number; stderrMaxBytes: number },
): StreamScanner {
  let lineBuf = '';
  let stdoutDeltaBytes = 0;
  let stderrDeltaBytes = 0;
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const stderrDecoder = new TextDecoder('utf-8', { fatal: false });

  // PHASE-marker lines are stripped from the live tail so the user doesn't
  // briefly see `PHASE: installing` in the canvas. Non-marker lines are
  // forwarded WITH their trailing newline so the platform-side append produces
  // a faithful tail.
  const handleStdoutLine = (line: string) => {
    if (line === PHASE_INSTALL) {
      cb.onPhase?.({ phase: 'installing' });
    } else if (line === PHASE_RUN) {
      cb.onPhase?.({ phase: 'running' });
    } else if (cb.onStdoutDelta && stdoutDeltaBytes < caps.stdoutMaxBytes) {
      const payload = `${line}\n`;
      stdoutDeltaBytes += payload.length;
      cb.onStdoutDelta(payload);
    }
  };

  const wantStdoutScan = Boolean(cb.onPhase || cb.onStdoutDelta);
  const onStdoutChunk = wantStdoutScan
    ? (chunk: Uint8Array) => {
        lineBuf += decoder.decode(chunk, { stream: true });
        // Flush newline-delimited prefixes first so partial markers at the
        // seam don't get clipped.
        let nl: number;
        while ((nl = lineBuf.indexOf('\n')) !== -1) {
          const line = lineBuf.slice(0, nl);
          lineBuf = lineBuf.slice(nl + 1);
          handleStdoutLine(line);
        }
        // No-newline blast guard: flush the prefix so heap can't grow unbounded.
        if (lineBuf.length > MAX_LINE_BUF_BYTES) {
          const synthetic = lineBuf.slice(0, MAX_LINE_BUF_BYTES);
          lineBuf = lineBuf.slice(MAX_LINE_BUF_BYTES);
          handleStdoutLine(synthetic);
        }
      }
    : undefined;

  const onStderrChunk = cb.onStderrDelta
    ? (chunk: Uint8Array) => {
        if (stderrDeltaBytes >= caps.stderrMaxBytes) return;
        const text = stderrDecoder.decode(chunk, { stream: true });
        if (text.length === 0) return;
        stderrDeltaBytes += text.length;
        cb.onStderrDelta?.(text);
      }
    : undefined;

  const finalize = () => {
    // EOF drain — the line loop only fires on newlines; a final unterminated
    // line (PHASE marker OR user output) lives in lineBuf.
    if (wantStdoutScan) {
      lineBuf += decoder.decode();
      if (lineBuf.length > 0) {
        if (lineBuf === PHASE_INSTALL) {
          cb.onPhase?.({ phase: 'installing' });
        } else if (lineBuf === PHASE_RUN) {
          cb.onPhase?.({ phase: 'running' });
        } else {
          cb.onStdoutDelta?.(lineBuf);
        }
      }
    }
    if (cb.onStderrDelta) {
      const tail = stderrDecoder.decode();
      if (tail.length > 0) cb.onStderrDelta(tail);
    }
  };

  return {
    ...(onStdoutChunk && { onStdoutChunk }),
    ...(onStderrChunk && { onStderrChunk }),
    finalize,
  };
}

/**
 * Generate the multi-step wrapper script that lands at /workspace/.tale/
 * runner.{py,js} in steps mode. Each step is invoked as a child process with
 * the same cwd and inherited stdio so the user's stdout / stderr stream
 * through unchanged; the wrapper prints a banner around each step. Per-step
 * `{path, exitCode, durationMs, status}` records are written to
 * /workspace/output/.tale-steps/results.json (after every step, so a SIGKILL
 * mid-flight still leaves partial state). Fail-fast: a non-zero exit aborts
 * the remaining steps (recorded `skipped`) and the wrapper exits with the
 * first non-zero code, surfacing to classifyFailure().
 */
export function buildMultiStepWrapper(
  language: 'python' | 'node' | 'polyglot',
  steps: readonly string[],
): string {
  const stepsJson = JSON.stringify(steps);
  if (language === 'polyglot') {
    return `# Tale polyglot multi-step wrapper — generated, do not edit.
import json
import os
import subprocess
import sys
import time

STEPS = ${stepsJson}
RESULTS_DIR = "/workspace/output/${STEPS_INTERNAL_DIR}"
RESULTS_PATH = os.path.join(RESULTS_DIR, "${STEPS_RESULTS_FILENAME}")

os.makedirs(RESULTS_DIR, exist_ok=True)
results = []

def interpreter_for(path):
    lower = path.lower()
    if lower.endswith(".py"):
        return "python3"
    if lower.endswith(".js") or lower.endswith(".cjs") or lower.endswith(".mjs"):
        return "node"
    if lower.endswith(".sh"):
        return "bash"
    return None

def flush_results():
    try:
        with open(RESULTS_PATH, "w") as fh:
            json.dump(results, fh)
    except Exception as exc:
        sys.stderr.write(f"[tale-runner] failed to persist step results: {exc}\\n")

failed_idx = None
for i, path in enumerate(STEPS):
    interp = interpreter_for(path)
    banner = f"====== STEP {i + 1}/{len(STEPS)}: {path} ({interp or '?'}) ======"
    sys.stdout.write(banner + "\\n")
    sys.stdout.flush()
    started = time.time()
    if interp is None:
        sys.stderr.write(f"[tale-runner] step {path} has no known interpreter\\n")
        exit_code = 65
    else:
        try:
            completed = subprocess.run(
                [interp, path],
                cwd="/workspace/code",
            )
            exit_code = completed.returncode
        except FileNotFoundError as exc:
            sys.stderr.write(f"[tale-runner] step {path} not found: {exc}\\n")
            exit_code = 127
        except Exception as exc:
            sys.stderr.write(f"[tale-runner] step {path} crashed: {exc}\\n")
            exit_code = 1
    duration_ms = int((time.time() - started) * 1000)
    status = "completed" if exit_code == 0 else "failed"
    results.append(
        {
            "path": path,
            "exitCode": exit_code,
            "durationMs": duration_ms,
            "status": status,
        }
    )
    sys.stdout.write(
        f"====== STEP {i + 1}/{len(STEPS)} END (exit {exit_code}, {duration_ms}ms) ======\\n"
    )
    sys.stdout.flush()
    flush_results()
    if exit_code != 0:
        failed_idx = i
        break

if failed_idx is not None:
    for j in range(failed_idx + 1, len(STEPS)):
        results.append(
            {
                "path": STEPS[j],
                "exitCode": None,
                "durationMs": 0,
                "status": "skipped",
            }
        )
    flush_results()
    sys.exit(results[failed_idx]["exitCode"] or 1)

sys.exit(0)
`;
  }
  if (language === 'python') {
    return `# Tale multi-step wrapper — generated, do not edit.
import json
import os
import subprocess
import sys
import time

STEPS = ${stepsJson}
RESULTS_DIR = "/workspace/output/${STEPS_INTERNAL_DIR}"
RESULTS_PATH = os.path.join(RESULTS_DIR, "${STEPS_RESULTS_FILENAME}")

os.makedirs(RESULTS_DIR, exist_ok=True)
results = []

def flush_results():
    try:
        with open(RESULTS_PATH, "w") as fh:
            json.dump(results, fh)
    except Exception as exc:
        sys.stderr.write(f"[tale-runner] failed to persist step results: {exc}\\n")

failed_idx = None
for i, path in enumerate(STEPS):
    banner = f"====== STEP {i + 1}/{len(STEPS)}: {path} ======"
    sys.stdout.write(banner + "\\n")
    sys.stdout.flush()
    started = time.time()
    try:
        completed = subprocess.run(
            [sys.executable, path],
            cwd="/workspace/code",
        )
        exit_code = completed.returncode
    except FileNotFoundError as exc:
        sys.stderr.write(f"[tale-runner] step {path} not found: {exc}\\n")
        exit_code = 127
    except Exception as exc:
        sys.stderr.write(f"[tale-runner] step {path} crashed: {exc}\\n")
        exit_code = 1
    duration_ms = int((time.time() - started) * 1000)
    status = "completed" if exit_code == 0 else "failed"
    results.append(
        {
            "path": path,
            "exitCode": exit_code,
            "durationMs": duration_ms,
            "status": status,
        }
    )
    sys.stdout.write(
        f"====== STEP {i + 1}/{len(STEPS)} END (exit {exit_code}, {duration_ms}ms) ======\\n"
    )
    sys.stdout.flush()
    flush_results()
    if exit_code != 0:
        failed_idx = i
        break

if failed_idx is not None:
    for j in range(failed_idx + 1, len(STEPS)):
        results.append(
            {
                "path": STEPS[j],
                "exitCode": None,
                "durationMs": 0,
                "status": "skipped",
            }
        )
    flush_results()
    sys.exit(results[failed_idx]["exitCode"] or 1)

sys.exit(0)
`;
  }
  // node
  return `// Tale multi-step wrapper — generated, do not edit.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const STEPS = ${stepsJson};
const RESULTS_DIR = '/workspace/output/${STEPS_INTERNAL_DIR}';
const RESULTS_PATH = path.join(RESULTS_DIR, '${STEPS_RESULTS_FILENAME}');

fs.mkdirSync(RESULTS_DIR, { recursive: true });
const results = [];

function flushResults() {
  try {
    fs.writeFileSync(RESULTS_PATH, JSON.stringify(results));
  } catch (err) {
    process.stderr.write(\`[tale-runner] failed to persist step results: \${err}\\n\`);
  }
}

let failedIdx = null;
for (let i = 0; i < STEPS.length; i++) {
  const step = STEPS[i];
  process.stdout.write(\`====== STEP \${i + 1}/\${STEPS.length}: \${step} ======\\n\`);
  const startedAt = Date.now();
  let exitCode;
  try {
    const child = spawnSync(process.execPath, [step], {
      cwd: '/workspace/code',
      stdio: 'inherit',
    });
    if (child.error) {
      process.stderr.write(\`[tale-runner] step \${step} crashed: \${child.error.message}\\n\`);
      exitCode = 1;
    } else if (child.status === null) {
      // Killed by signal; surface SIGKILL-equivalent exit code so the host
      // classifyFailure() still maps to RUNTIME_ERROR / OOM as appropriate.
      exitCode = child.signal === 'SIGKILL' ? 137 : 1;
    } else {
      exitCode = child.status;
    }
  } catch (err) {
    process.stderr.write(\`[tale-runner] step \${step} threw: \${err}\\n\`);
    exitCode = 1;
  }
  const durationMs = Date.now() - startedAt;
  const status = exitCode === 0 ? 'completed' : 'failed';
  results.push({ path: step, exitCode, durationMs, status });
  process.stdout.write(
    \`====== STEP \${i + 1}/\${STEPS.length} END (exit \${exitCode}, \${durationMs}ms) ======\\n\`,
  );
  flushResults();
  if (exitCode !== 0) {
    failedIdx = i;
    break;
  }
}

if (failedIdx !== null) {
  for (let j = failedIdx + 1; j < STEPS.length; j++) {
    results.push({
      path: STEPS[j],
      exitCode: null,
      durationMs: 0,
      status: 'skipped',
    });
  }
  flushResults();
  process.exit(results[failedIdx].exitCode || 1);
}

process.exit(0);
`;
}

// Defaults for the pre-stage fetch. Overridable so unit tests can run with
// tighter values without waiting on real timeouts.
const PRIOR_FETCH_DEFAULT_TIMEOUT_MS = 30_000;
const PRIOR_FETCH_DEFAULT_MAX_BYTES = 100 * 1024 * 1024; // 100 MB
const WORKSPACE_FETCH_TIMEOUT_MS = 30_000;
const WORKSPACE_FETCH_MAX_BYTES = 100 * 1024 * 1024; // 100 MB
const USER_UPLOAD_FETCH_TIMEOUT_MS = 30_000;
const USER_UPLOAD_FETCH_MAX_BYTES = 100 * 1024 * 1024; // 100 MB

interface StagePriorOpts {
  timeoutMs?: number;
  maxBytesPerFile?: number;
}

type FetchUrlResult =
  | { ok: true; bytes: number; sha256: string }
  | { ok: false; reason: PriorStageSkipReason; detail: string };

/**
 * Fetch `url` into `dest` with timeout, Content-Length pre-check, and
 * stream-and-cap byte ceiling. Computes sha256. Caller validates `dest`
 * against its own safe-directory boundary first.
 */
export async function fetchUrlToFile(
  url: string,
  dest: string,
  opts: { timeoutMs: number; maxBytesPerFile: number },
): Promise<FetchUrlResult> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(opts.timeoutMs) });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const reason: PriorStageSkipReason =
      err instanceof Error && err.name === 'TimeoutError'
        ? 'fetch_timeout'
        : 'fetch_failed';
    return { ok: false, reason, detail };
  }
  if (!res.ok) {
    const reason: PriorStageSkipReason =
      res.status === 403 || res.status === 410 ? 'url_expired' : 'http_error';
    return { ok: false, reason, detail: `HTTP ${res.status}` };
  }
  const contentLengthHeader = res.headers.get('content-length');
  if (contentLengthHeader !== null) {
    const declaredBytes = Number(contentLengthHeader);
    if (
      Number.isFinite(declaredBytes) &&
      declaredBytes > opts.maxBytesPerFile
    ) {
      return {
        ok: false,
        reason: 'download_too_large',
        detail: `Content-Length ${declaredBytes} exceeds cap ${opts.maxBytesPerFile}`,
      };
    }
  }
  try {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let oversize = false;
    if (res.body !== null) {
      const reader = res.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value === undefined) continue;
          if (total + value.byteLength > opts.maxBytesPerFile) {
            oversize = true;
            break;
          }
          chunks.push(value);
          total += value.byteLength;
        }
      } finally {
        try {
          reader.releaseLock();
        } catch (err) {
          console.warn('[sandbox] fetchUrlToFile reader.releaseLock:', err);
        }
      }
    }
    if (oversize) {
      return {
        ok: false,
        reason: 'download_too_large',
        detail: `streamed > ${opts.maxBytesPerFile} bytes`,
      };
    }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const sha256 = createHash('sha256').update(buf).digest('hex');
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, buf);
    return { ok: true, bytes: buf.byteLength, sha256 };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: 'write_failed', detail };
  }
}

async function stageDownloadsToDir(
  targetDir: string,
  downloads: ReadonlyArray<{ name: string; url: string }>,
  opts: { timeoutMs: number; maxBytesPerFile: number },
  logLabel: string,
): Promise<PriorStageResult> {
  const staged: PriorStageResult['staged'] = [];
  const skipped: PriorStageResult['skipped'] = [];
  for (const file of downloads) {
    const dest = resolve(targetDir, file.name);
    if (dest !== targetDir && !dest.startsWith(targetDir + sep)) {
      const detail = `resolved path escapes targetDir`;
      console.warn(
        `[sandbox] skipping unsafe ${logLabel} name: ${JSON.stringify(file.name)} (${detail})`,
      );
      skipped.push({ name: file.name, reason: 'unsafe_path', detail });
      continue;
    }
    const result = await fetchUrlToFile(file.url, dest, opts);
    if (!result.ok) {
      console.warn(
        `[sandbox] ${logLabel} ${result.reason} for ${JSON.stringify(file.name)}: ${result.detail}`,
      );
      skipped.push({
        name: file.name,
        reason: result.reason,
        detail: result.detail,
      });
      continue;
    }
    staged.push({
      name: file.name,
      bytes: result.bytes,
      sha256: result.sha256,
    });
  }
  if (staged.length > 0) {
    console.info(
      `[sandbox.stage] pre-staged ${staged.length} file(s) into ${targetDir}: ${JSON.stringify(staged.map((s) => s.name))}`,
    );
  }
  if (skipped.length > 0) {
    console.warn(
      `[sandbox.stage] skipped ${skipped.length} ${logLabel}(s): ${JSON.stringify(skipped)}`,
    );
  }
  return { staged, skipped };
}

export async function stagePriorOutputDownloads(
  outputDir: string,
  downloads: ReadonlyArray<{ name: string; url: string }>,
  opts: StagePriorOpts = {},
): Promise<PriorStageResult> {
  return stageDownloadsToDir(
    outputDir,
    downloads,
    {
      timeoutMs: opts.timeoutMs ?? PRIOR_FETCH_DEFAULT_TIMEOUT_MS,
      maxBytesPerFile: opts.maxBytesPerFile ?? PRIOR_FETCH_DEFAULT_MAX_BYTES,
    },
    'prior-output',
  );
}

async function stageUserUploadDownloads(
  uploadsDir: string,
  downloads: ReadonlyArray<{ name: string; url: string }>,
  opts: StagePriorOpts = {},
): Promise<void> {
  await stageDownloadsToDir(
    uploadsDir,
    downloads,
    {
      timeoutMs: opts.timeoutMs ?? USER_UPLOAD_FETCH_TIMEOUT_MS,
      maxBytesPerFile: opts.maxBytesPerFile ?? USER_UPLOAD_FETCH_MAX_BYTES,
    },
    'user-upload',
  );
}

/**
 * Stage code/ + inputs into a `/workspace`-shaped `hostDir` (downloads from
 * presigned URLs, writes packages.json/options.json + the multi-step wrapper).
 * Used by the docker path (on the bind-mounted host dir) AND the k8s in-Pod
 * `stage` mode (on the Pod's emptyDir). Returns the prior-stage attestation.
 */
export async function stageWorkspace(
  hostDir: string,
  req: ExecuteRequest,
): Promise<{ priorStage?: PriorStageResult }> {
  const codeDir = join(hostDir, 'code');
  const outputDir = join(hostDir, 'output');
  const uploadsDir = join(hostDir, 'uploads');
  await mkdir(codeDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  await mkdir(uploadsDir, { recursive: true });

  let priorStage: PriorStageResult | undefined;
  if (
    req.priorOutputDownloads !== undefined &&
    req.priorOutputDownloads.length > 0
  ) {
    priorStage = await stagePriorOutputDownloads(
      outputDir,
      req.priorOutputDownloads,
    );
  }

  if (
    req.userUploadDownloads !== undefined &&
    req.userUploadDownloads.length > 0
  ) {
    await stageUserUploadDownloads(uploadsDir, req.userUploadDownloads);
  }

  if (req.files !== undefined) {
    for (const file of req.files) {
      const dest = resolve(codeDir, file.path);
      if (dest !== codeDir && !dest.startsWith(codeDir + sep)) {
        throw new Error(
          `sandbox staging refused unsafe file path: ${JSON.stringify(file.path)}`,
        );
      }
      const result = await fetchUrlToFile(file.url, dest, {
        timeoutMs: WORKSPACE_FETCH_TIMEOUT_MS,
        maxBytesPerFile: WORKSPACE_FETCH_MAX_BYTES,
      });
      if (!result.ok) {
        throw new Error(
          `sandbox workspace file fetch failed for ${JSON.stringify(file.path)}: ${result.reason} (${result.detail})`,
        );
      }
    }
  }

  if (req.steps !== undefined) {
    if (req.language === 'bash') {
      throw new Error(
        'spawn: language=bash + steps[] should have been rejected by validate-request',
      );
    }
    const taleDir = join(hostDir, '.tale');
    await mkdir(taleDir, { recursive: true });
    const wrapperName =
      req.language === 'python' || req.language === 'polyglot'
        ? 'runner.py'
        : 'runner.js';
    await writeFile(
      join(taleDir, wrapperName),
      buildMultiStepWrapper(req.language, req.steps),
    );
  }

  if (req.language === 'polyglot') {
    const byLang = req.packagesByLang ?? {};
    await writeFile(
      join(codeDir, 'packages-python.json'),
      JSON.stringify(byLang.python ?? []),
    );
    await writeFile(
      join(codeDir, 'packages-node.json'),
      JSON.stringify(byLang.node ?? []),
    );
    await writeFile(join(codeDir, 'packages.json'), '[]');
  } else {
    const single =
      req.packages !== undefined
        ? req.packages
        : req.language === 'bash'
          ? []
          : (req.packagesByLang?.[req.language] ?? []);
    await writeFile(
      join(codeDir, 'packages.json'),
      JSON.stringify(single ?? []),
    );
  }
  await writeFile(join(codeDir, 'options.json'), '{}');

  return { ...(priorStage !== undefined && { priorStage }) };
}

export interface HarvestEndpoints {
  outputUrlEndpoint: string;
  reportUploadedEndpoint: string;
}

export interface HarvestResult {
  files: OutputFile[];
  truncatedCount: number;
  uploadStats: UploadStats;
  quotaExhausted: boolean;
  uploadFailed: boolean;
  reportFailed: boolean;
  readFailed: boolean;
  uploadMs: number;
}

/**
 * Walk `/workspace/output/`, POST each file to a presigned upload slot, and
 * report each storageId via EP2. Slots come from the pre-allocated pool first,
 * then lazily from EP1. Errors accumulate into `uploadStats.failures` rather
 * than throwing. Used by the docker path AND the k8s in-Pod `harvest` mode.
 */
export async function harvestOutputDir(
  hostDir: string,
  caps: { perFileMax: number; totalMax: number },
  uploadSlots: ReadonlyArray<{ url: string }>,
  endpoints: HarvestEndpoints,
  executionId: string,
  sandboxToken: string | null,
): Promise<HarvestResult> {
  const outputDir = join(hostDir, 'output');
  const files: OutputFile[] = [];
  let truncatedCount = 0;
  let totalAccepted = 0;
  const slotPool: string[] = uploadSlots.map((s) => s.url);
  let slotIndex = 0;
  const failures: UploadFailure[] = [];
  let attempted = 0;
  let succeeded = 0;
  let quotaExhausted = false;
  let uploadFailed = false;
  let reportFailed = false;
  let readFailed = false;
  const startUpload = Date.now();

  async function nextSlotUrl(): Promise<string | null> {
    if (slotPool.length > 0) {
      const url = slotPool.shift();
      return url ?? null;
    }
    if (quotaExhausted) return null;
    const result = await requestUploadUrls(
      endpoints.outputUrlEndpoint,
      executionId,
      2,
      { token: sandboxToken },
    );
    if (!result.ok) {
      if (result.code === 'QUOTA_EXCEEDED') {
        quotaExhausted = true;
      } else {
        uploadFailed = true;
      }
      failures.push({
        slotIndex: -1,
        fileName: '(slot-request)',
        httpStatus: result.status,
        errorSnippet: result.snippet,
      });
      return null;
    }
    for (const u of result.urls) slotPool.push(u);
    const url = slotPool.shift();
    return url ?? null;
  }

  async function walk(rel: string): Promise<void> {
    const abs = join(outputDir, rel);
    let entries;
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch (err) {
      console.warn(`[sandbox.harvest] failed to read output dir ${abs}:`, err);
      readFailed = true;
      return;
    }
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      const childAbs = join(outputDir, childRel);
      if (rel === '' && e.name === STEPS_INTERNAL_DIR) continue;
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
      const url = await nextSlotUrl();
      if (url === null) {
        attempted += 1;
        failures.push({
          slotIndex: slotIndex,
          fileName: childRel,
          httpStatus: quotaExhausted ? 412 : 0,
          errorSnippet: quotaExhausted
            ? 'per-run output quota exceeded'
            : 'no upload slot available',
        });
        continue;
      }
      attempted += 1;
      const bytes = await readFile(childAbs);
      const contentType = guessContentType(childRel);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const postResult = await postToUploadSlot(
        url,
        bytes,
        contentType,
        slotIndex,
        childRel,
      );
      slotIndex += 1;
      if (!postResult.ok) {
        uploadFailed = true;
        failures.push(postResult.failure);
        continue;
      }
      const reportResult = await reportUploaded(
        endpoints.reportUploadedEndpoint,
        executionId,
        {
          fileName: childRel,
          storageId: postResult.storageId,
          size: st.size,
          contentType,
        },
        { token: sandboxToken },
      );
      if (!reportResult.ok) {
        reportFailed = true;
        failures.push({
          slotIndex: slotIndex - 1,
          fileName: childRel,
          httpStatus: reportResult.status,
          errorSnippet: `EP2: ${reportResult.snippet}`,
        });
      }
      files.push({
        name: childRel,
        storageId: postResult.storageId,
        size: st.size,
        contentType,
        sha256,
      });
      totalAccepted += st.size;
      succeeded += 1;
    }
  }
  await walk('');
  return {
    files,
    truncatedCount,
    uploadStats: { attempted, succeeded, failures },
    quotaExhausted,
    uploadFailed,
    reportFailed,
    readFailed,
    uploadMs: Date.now() - startUpload,
  };
}

/**
 * Read per-step results written by the wrapper into
 * `/workspace/output/.tale-steps/results.json`. Returns `null` if missing or
 * malformed. Validates each entry's shape.
 */
export async function readStepResults(
  hostDir: string,
  requestedSteps: readonly string[],
): Promise<SandboxStepResult[] | null> {
  const resultsPath = join(
    hostDir,
    'output',
    STEPS_INTERNAL_DIR,
    STEPS_RESULTS_FILENAME,
  );
  let raw: string;
  try {
    raw = (await readFile(resultsPath)).toString('utf8');
  } catch (err) {
    if (
      err !== null &&
      typeof err === 'object' &&
      'code' in err &&
      err.code === 'ENOENT'
    ) {
      return null;
    }
    console.warn(`[sandbox.harvest] failed to read step results:`, err);
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn(`[sandbox.harvest] step results JSON malformed:`, err);
    return null;
  }
  if (!Array.isArray(parsed)) {
    console.warn(`[sandbox.harvest] step results not an array`);
    return null;
  }
  const out: SandboxStepResult[] = [];
  const allowedStatuses: ReadonlySet<string> = new Set([
    'completed',
    'failed',
    'skipped',
  ] satisfies readonly SandboxStepStatus[]);
  const isStepStatus = (v: string): v is SandboxStepStatus =>
    allowedStatuses.has(v);
  for (const entry of parsed) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    const e = entry as Record<string, unknown>;
    if (typeof e.path !== 'string') continue;
    if (typeof e.status !== 'string' || !isStepStatus(e.status)) {
      continue;
    }
    const exitCode =
      typeof e.exitCode === 'number'
        ? e.exitCode
        : e.exitCode === null
          ? null
          : 1;
    const durationMs =
      typeof e.durationMs === 'number' && Number.isFinite(e.durationMs)
        ? e.durationMs
        : 0;
    out.push({
      path: e.path,
      status: e.status,
      exitCode,
      durationMs,
    });
  }
  if (out.length === 0) return null;
  const requested = new Set(requestedSteps);
  return out.filter((s) => requested.has(s.path));
}

export function guessContentType(name: string): string {
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
 * Synthesize a `steps[]` payload when the wrapper never produced results.json
 * (container killed mid-install, spawner-side crash, etc). Every step is
 * `skipped`; the caller may replace the first with `failed`.
 */
export function synthesizeStepResults(
  steps: readonly string[],
): SandboxStepResult[] {
  return steps.map((path) => ({
    path,
    status: 'skipped',
    exitCode: null,
    durationMs: 0,
  }));
}

export function makeError(
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
    truncated: { stdout: false, stderr: false, files: 0 },
    outputFiles: [],
  };
}

export function stripPhaseMarkers(stdout: string): string {
  return stdout
    .split('\n')
    .filter((line) => line !== PHASE_INSTALL && line !== PHASE_RUN)
    .join('\n');
}

// Strip ANSI CSI / OSC sequences and bare control characters that user code
// (or pip/npm progress bars) emits, so the chat-canvas doesn't render garbage.
const ANSI_CSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const ANSI_OSC_BEL_RE = /\x1b\][^\x07]*\x07/g;
const ANSI_OSC_ST_RE = /\x1b\][^\x1b]*\x1b\\/g;
const ESC_AND_CONTROL_RE = /[\x07\x08\x0b\x0c\x0e-\x1a\x1c-\x1f]/g;

export function stripControlChars(text: string): string {
  return text
    .replace(ANSI_OSC_BEL_RE, '')
    .replace(ANSI_OSC_ST_RE, '')
    .replace(ANSI_CSI_RE, '')
    .replace(ESC_AND_CONTROL_RE, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

export function capText(
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

export function classifyFailure(
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
    return { code: 'INSTALL_FAILED', message: 'Package install failed' };
  }
  if (exitCode === 65) {
    return {
      code: 'SPAWNER_UNAVAILABLE',
      message: 'Sandbox runtime rejected the invocation',
    };
  }
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
