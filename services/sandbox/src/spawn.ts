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

import { createHash } from 'node:crypto';
import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
  lchown,
} from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import { buildDockerRunArgs } from './docker-args.ts';
import {
  postToUploadSlot,
  reportUploaded,
  requestUploadUrls,
} from './sandbox-callback.ts';
import { runDocker, dockerKill, dockerRm } from './spawn-util.ts';
import type {
  ErrorCode,
  ExecuteRequest,
  ExecuteResponse,
  OutputFile,
  PriorStageResult,
  PriorStageSkipReason,
  SpawnerConfig,
  UploadFailure,
  UploadStats,
} from './types.ts';
import {
  ensureCacheVolume,
  npmCacheVolumeName,
  pipCacheVolumeName,
} from './volume.ts';
import {
  ID_ALPHABET_RE,
  ORG_ID_ALPHABET_RE,
  type SandboxPhaseEvent,
  type SandboxStepResult,
  type SandboxStepStatus,
} from './wire.ts';

// Hidden directory inside /workspace/output/ where the multi-step wrapper
// writes its per-step bookkeeping. The harvest path filters anything under
// this prefix so the bookkeeping never appears in the user-visible output
// file chips.
const STEPS_INTERNAL_DIR = '.tale-steps';
const STEPS_RESULTS_FILENAME = 'results.json';

const PHASE_INSTALL = 'PHASE: installing';
const PHASE_RUN = 'PHASE: running';
const RUNTIME_UID = 65534;
const RUNTIME_GID = 65534;

interface InFlight {
  containerName: string;
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
    containerName: `tale-sbx-${executionId}`,
    abort: new AbortController(),
    startedAt: Date.now(),
  });
}

export function unregisterInFlight(executionId: string): void {
  inFlight.delete(executionId);
}

export async function cancelExecution(executionId: string): Promise<boolean> {
  const entry = inFlight.get(executionId);
  if (!entry) return false;
  entry.abort.abort('cancelled by client');
  // Hard ceiling on docker kill so a wedged daemon can't hang the cancel
  // HTTP response. The timeoutMs is passed THROUGH to runDocker so the
  // underlying Bun subprocess is killed too — earlier this used an outer
  // `withTimeout` wrapper which only rejected the promise but left the
  // docker CLI child running (audit follow-up F4).
  try {
    await dockerKill(entry.containerName, 'TERM', { timeoutMs: 5_000 });
  } catch (err) {
    console.warn(
      `[sandbox.cancel] dockerKill timed out / failed for ${executionId}:`,
      err,
    );
    try {
      await dockerKill(entry.containerName, 'KILL', { timeoutMs: 5_000 });
    } catch (forceErr) {
      console.error(
        `[sandbox.cancel] forced dockerKill also failed for ${executionId}:`,
        forceErr,
      );
    }
  }
  return true;
}

/**
 * Generate the multi-step wrapper script that lands at /workspace/code/
 * main.{py,js} in steps mode. Each step is invoked as a child process
 * with the same cwd and inherited stdio so the user's stdout / stderr
 * stream through unchanged; the wrapper itself prints a short banner
 * around each step so a human reading the log can tell where boundaries
 * fall. Per-step `{path, exitCode, durationMs, status}` records are
 * written to /workspace/output/.tale-steps/results.json at the end (and
 * also after every step in case the container is SIGKILLed mid-flight).
 *
 * Fail-fast: a non-zero exit aborts the remaining steps, which are
 * recorded as `status: 'skipped'` so the caller can attribute the gap.
 * The wrapper exits with the first non-zero exit code, surfacing the
 * failure to docker's exit code → spawn.ts's classifyFailure().
 *
 * The step list is serialized as JSON inline (steps are validated paths,
 * <= 200 chars, safe-alphabet, cap MAX_STEPS_PER_REQUEST) so the wrapper
 * has zero external configuration.
 */
function buildMultiStepWrapper(
  language: 'python' | 'node' | 'polyglot',
  steps: readonly string[],
): string {
  const stepsJson = JSON.stringify(steps);
  if (language === 'polyglot') {
    // Polyglot mode: per-step interpreter selected by file extension at
    // runtime. Wrapper is Python (always present — image's base layer)
    // and shells out via subprocess to either `python3` or `node`. The
    // `results.json` shape is identical to the single-language wrappers
    // so the spawner's `readStepResults` consumer is unchanged.
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

/**
 * Pre-stage the artifact's previous run outputs into `/workspace/output/`.
 *
 * Post-sandbox-wobbly-origami plan §1: instead of receiving base64-inlined
 * bytes, the spawner now gets a list of `{name, url}` and fetches each
 * URL itself (URLs are pre-rewritten through `toSandboxStorageUrl()` on the
 * platform side so they target the internal Caddy alias). Path safety is
 * still enforced here as defense in depth.
 *
 * Bad names / failed fetches are skipped (logged), not fatal — pre-staging
 * is a best-effort convenience layer, not a correctness contract.
 *
 * Exported so the unit test can exercise the path-traversal guard.
 */
// Defaults for the pre-stage fetch. Overridable so unit tests can run
// with tighter values without waiting on real timeouts.
export const PRIOR_FETCH_DEFAULT_TIMEOUT_MS = 30_000;
export const PRIOR_FETCH_DEFAULT_MAX_BYTES = 100 * 1024 * 1024; // 100 MB

interface StagePriorOpts {
  timeoutMs?: number;
  maxBytesPerFile?: number;
}

export async function stagePriorOutputDownloads(
  outputDir: string,
  downloads: ReadonlyArray<{ name: string; url: string }>,
  opts: StagePriorOpts = {},
): Promise<PriorStageResult> {
  const timeoutMs = opts.timeoutMs ?? PRIOR_FETCH_DEFAULT_TIMEOUT_MS;
  const maxBytesPerFile = opts.maxBytesPerFile ?? PRIOR_FETCH_DEFAULT_MAX_BYTES;
  const staged: PriorStageResult['staged'] = [];
  const skipped: PriorStageResult['skipped'] = [];
  for (const file of downloads) {
    const dest = resolve(outputDir, file.name);
    // Defense in depth — refuse anything escaping outputDir.
    if (dest !== outputDir && !dest.startsWith(outputDir + sep)) {
      const detail = `resolved path escapes outputDir`;
      console.warn(
        `[sandbox] skipping unsafe prior-output name: ${JSON.stringify(file.name)} (${detail})`,
      );
      skipped.push({ name: file.name, reason: 'unsafe_path', detail });
      continue;
    }
    let res: Response;
    try {
      // AbortSignal.timeout caps the round trip so a stalled presigned URL
      // can't hang stageWorkspace indefinitely (audit follow-up F5).
      res = await fetch(file.url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      // AbortSignal.timeout rejects with a DOMException whose `name` is
      // 'TimeoutError'; surface a distinct reason so the platform can
      // distinguish "URL was reachable" from "URL hung".
      const reason: PriorStageSkipReason =
        err instanceof Error && err.name === 'TimeoutError'
          ? 'fetch_timeout'
          : 'fetch_failed';
      console.warn(
        `[sandbox] prior-output fetch ${reason} for ${JSON.stringify(file.name)}: ${detail}`,
      );
      skipped.push({ name: file.name, reason, detail });
      continue;
    }
    if (!res.ok) {
      const detail = `HTTP ${res.status}`;
      console.warn(
        `[sandbox] prior-output fetch ${res.status} for ${JSON.stringify(file.name)}`,
      );
      // 403/410 from a presigned URL usually means TTL expired — give the
      // platform side a distinct reason so it can re-mint and retry rather
      // than failing the run outright (crispy-curry plan §3, url_expired).
      const reason: PriorStageSkipReason =
        res.status === 403 || res.status === 410 ? 'url_expired' : 'http_error';
      skipped.push({ name: file.name, reason, detail });
      continue;
    }
    // Fast-fail on Content-Length when the server provides one — avoids
    // streaming a known-too-large body just to reject it.
    const contentLengthHeader = res.headers.get('content-length');
    if (contentLengthHeader !== null) {
      const declaredBytes = Number(contentLengthHeader);
      if (Number.isFinite(declaredBytes) && declaredBytes > maxBytesPerFile) {
        const detail = `Content-Length ${declaredBytes} exceeds cap ${maxBytesPerFile}`;
        console.warn(
          `[sandbox] prior-output download_too_large for ${JSON.stringify(file.name)}: ${detail}`,
        );
        skipped.push({
          name: file.name,
          reason: 'download_too_large',
          detail,
        });
        continue;
      }
    }
    try {
      // Stream-and-cap. Without this a server that lies about (or omits)
      // Content-Length could still smuggle gigabytes through, filling the
      // host disk. We abort the read as soon as the running total crosses
      // the cap.
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
            if (total + value.byteLength > maxBytesPerFile) {
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
            console.warn('[sandbox] prior-output reader.releaseLock:', err);
          }
        }
      }
      if (oversize) {
        const detail = `streamed > ${maxBytesPerFile} bytes`;
        console.warn(
          `[sandbox] prior-output download_too_large for ${JSON.stringify(file.name)}: ${detail}`,
        );
        skipped.push({
          name: file.name,
          reason: 'download_too_large',
          detail,
        });
        continue;
      }
      const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
      const sha256 = createHash('sha256').update(buf).digest('hex');
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, buf);
      staged.push({ name: file.name, bytes: buf.byteLength, sha256 });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.warn(
        `[sandbox] failed to pre-stage ${JSON.stringify(file.name)}: ${detail}`,
      );
      skipped.push({ name: file.name, reason: 'write_failed', detail });
    }
  }
  // INFO so it's visible in `docker logs tale-sandbox` without having
  // to crank the global log level. Pre-stage is a black box otherwise.
  if (staged.length > 0) {
    console.info(
      `[sandbox.stage] pre-staged ${staged.length} file(s) into ${outputDir}: ${JSON.stringify(staged.map((s) => s.name))}`,
    );
  }
  if (skipped.length > 0) {
    console.warn(
      `[sandbox.stage] skipped ${skipped.length} prior-output(s): ${JSON.stringify(skipped)}`,
    );
  }
  return { staged, skipped };
}

export async function stageWorkspace(
  hostDir: string,
  req: ExecuteRequest,
): Promise<{ priorStage?: PriorStageResult }> {
  const codeDir = join(hostDir, 'code');
  const outputDir = join(hostDir, 'output');
  await mkdir(codeDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });

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

  // Stage user files at their declared paths under /workspace/code/.
  // In single-script mode the entry file lives here; in multi-step mode
  // every step + its siblings live here. No synthetic mirror — the runtime
  // entrypoint exec()s the file at its declared path, so tracebacks and
  // `__file__` carry the user's real filename.
  // Path safety already enforced by validate-request.ts; this resolve+prefix
  // check is defense-in-depth — if the validator ever regresses, here we
  // refuse to write outside codeDir.
  if (req.files !== undefined) {
    for (const file of req.files) {
      const dest = resolve(codeDir, file.path);
      if (dest !== codeDir && !dest.startsWith(codeDir + sep)) {
        throw new Error(
          `sandbox staging refused unsafe file path: ${JSON.stringify(file.path)}`,
        );
      }
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, file.content);
    }
  }

  // Multi-step mode: write the spawner-generated wrapper to a hidden dir
  // outside /workspace/code/. The validator already rejects user paths
  // with dotfile segments, so /workspace/.tale/ is guaranteed disjoint
  // from anything in req.files[] — user step names like `main.py` cannot
  // collide with the wrapper.
  if (req.steps !== undefined) {
    const taleDir = join(hostDir, '.tale');
    await mkdir(taleDir, { recursive: true });
    // Wrapper filename: legacy single-language wrappers keep their
    // language-tagged names (runner.py / runner.js) so any operator
    // grep'ing through /workspace/.tale/ still sees what to expect.
    // Polyglot mode emits a Python-hosted dispatcher (the image base
    // layer always has python3 available).
    const wrapperName =
      req.language === 'python' || req.language === 'polyglot'
        ? 'runner.py'
        : 'runner.js';
    await writeFile(
      join(taleDir, wrapperName),
      buildMultiStepWrapper(req.language, req.steps),
    );
  }

  // Polyglot mode: stage per-language buckets in separate files so the
  // entrypoint can decide whether to run pip and/or npm independently.
  // Single-language modes keep the legacy single-file shape so existing
  // tests and any old client still work unchanged.
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
    // Legacy packages.json is left empty so a malformed `cat` from a
    // future debug script doesn't print stale data.
    await writeFile(join(codeDir, 'packages.json'), '[]');
  } else {
    // For single-runtime requests prefer `packages[]`. If a caller sent
    // `packagesByLang` here too, extract just the matching bucket so the
    // wire is forgiving.
    const single =
      req.packages !== undefined
        ? req.packages
        : (req.packagesByLang?.[req.language] ?? []);
    await writeFile(
      join(codeDir, 'packages.json'),
      JSON.stringify(single ?? []),
    );
  }
  await writeFile(
    join(codeDir, 'options.json'),
    JSON.stringify(req.options ?? {}),
  );

  // Spawner runs as root; the runtime container runs as nobody (65534) and
  // needs to read the staged files. Recursively `lchown` (not `chown`) so a
  // symlink the runtime container planted into the bind-mounted workspace
  // CANNOT redirect ownership of an arbitrary host file (audit finding
  // R2-B4: latent footgun if session dirs ever get reused across runs).
  await chownRecursive(hostDir, RUNTIME_UID, RUNTIME_GID);
  return { ...(priorStage !== undefined && { priorStage }) };
}

async function chownRecursive(
  path: string,
  uid: number,
  gid: number,
): Promise<void> {
  await lchown(path, uid, gid);
  const entries = await readdir(path, { withFileTypes: true });
  for (const e of entries) {
    const p = join(path, e.name);
    if (e.isDirectory()) {
      await chownRecursive(p, uid, gid);
    } else {
      await lchown(p, uid, gid);
    }
  }
}

interface HarvestEndpoints {
  outputUrlEndpoint: string;
  reportUploadedEndpoint: string;
}

interface HarvestResult {
  files: OutputFile[];
  truncatedCount: number;
  uploadStats: UploadStats;
  /** True if any file hit `UPLOAD_QUOTA_EXCEEDED` while requesting slots. */
  quotaExhausted: boolean;
  /** True if any file failed the upload POST. */
  uploadFailed: boolean;
  /** True if any EP2 report-back failed (non-fatal, but surfaced). */
  reportFailed: boolean;
  /** True if the directory walk itself errored. */
  readFailed: boolean;
  uploadMs: number;
}

/**
 * Walk `/workspace/output/`, POST each file's bytes to a presigned upload
 * slot URL, and report each successful storageId via EP2. Slot URLs come
 * from the pre-allocated pool first; when that pool is empty we lazily
 * request more from EP1 (server-side quota gate may reject with 412).
 *
 * Errors are accumulated into `uploadStats.failures` rather than thrown —
 * caller decides which errorCode to surface based on the failure flags.
 * The HTTP status of the FIRST failure drives errorCode classification:
 * 412 → UPLOAD_QUOTA_EXCEEDED, anything else from postToUploadSlot →
 * UPLOAD_FAILED, EP2-only failures → UPLOAD_REPORT_FAILED.
 */
async function harvestOutputDir(
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
      // Pop FIFO so the order in audit logs matches the pre-alloc order.
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
      // Skip the multi-step wrapper's internal bookkeeping. The runner
      // writes per-step results to `/workspace/output/.tale-steps/` so the
      // host side can read structured per-step state — those files must
      // not appear in the user-visible outputFiles harvest.
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
        // Out of slots (quota OR network error). Mark this file failed
        // and continue — subsequent files will also fail-fast at
        // nextSlotUrl, recorded just once per cause.
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
      // sha256 is the per-file digest used by both the cumulative
      // `artifactOutputs` manifest (crispy-curry plan §1) and the
      // pre-stage attestation when this same file is later re-injected
      // into a future run. Computed once during harvest; piggy-backs on
      // the readFile we already did.
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
      // POST succeeded; report storageId via EP2 so the platform's
      // rollback set tracks the live blob before we send back the
      // final SSE result.
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
        // EP2 failure is non-fatal — the bytes are in storage, the
        // file is usable. Continue and surface via uploadStats.
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
 * `/workspace/output/.tale-steps/results.json`. Returns `null` if the
 * file is missing or malformed — callers should fall back to a synthetic
 * `[{status:'failed'}]` so the response shape is still valid. Validates
 * each entry's shape so a wrapper bug can't smuggle arbitrary JSON into
 * the response.
 */
async function readStepResults(
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
    // ENOENT is the most common — happens when the container was killed
    // before the wrapper could flush. Log only at debug-ish level.
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
  // Use a `ReadonlySet<string>` here so the `.has(value)` call accepts the
  // freshly-narrowed-but-still-`string` field without an extra cast. The
  // type-guard below keeps `status` typed as `SandboxStepStatus` for the
  // returned record.
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
    // After the guard `entry` is `object`; this is the canonical wire-shape
    // narrowing pattern in the repo (see spawn.ts header docs on validation).
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
  // Defense: ensure paths reference real requested steps. A wrapper bug
  // shouldn't surface an unrelated entry to the agent.
  const requested = new Set(requestedSteps);
  return out.filter((s) => requested.has(s.path));
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
  const containerName = `tale-sbx-${req.executionId}`;
  const pipVolume = pipCacheVolumeName(cfg, req.organizationId);
  const npmVolume = npmCacheVolumeName(cfg, req.organizationId);
  const workspaceHostDir = join(cfg.hostSessionRoot, req.executionId);

  // Reuse the placeholder AbortController if the server pre-registered one
  // when the request landed. A `cancelExecution` call between registerInFlight
  // and this line targets the placeholder's signal — discarding it here and
  // building a fresh controller would leak that early abort, leaving the
  // child docker process running until the watchdog timeout. Reusing the
  // entry preserves the (already-aborted, if cancelled) signal.
  const placeholder = inFlight.get(req.executionId);
  const abort = placeholder?.abort ?? new AbortController();
  inFlight.set(req.executionId, {
    containerName,
    abort,
    startedAt: startedAtMs,
  });

  try {
    await ensureCacheVolume(pipVolume);
    await ensureCacheVolume(npmVolume);
    const stageStartedAt = Date.now();
    const stageResult = await stageWorkspace(workspaceHostDir, req);
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
        ? `/workspace/.tale/${
            req.language === 'python' || req.language === 'polyglot'
              ? 'runner.py'
              : 'runner.js'
          }`
        : // oxlint-disable-next-line typescript/no-non-null-assertion -- validator enforces mutex (entryPath xor steps)
          req.entryPath!;

    const argv = buildDockerRunArgs(cfg, {
      executionId: req.executionId,
      organizationId: req.organizationId,
      language: req.language,
      timeoutMs,
      pipCacheVolume: pipVolume,
      npmCacheVolume: npmVolume,
      workspaceHostDir,
      startedAtMs,
      entryPath,
    });

    // Two-tier timeout:
    //   - Inner: at `timeoutMs`, SIGKILL the container so user code cannot
    //     exceed the cap. The runtime is untrusted; there's no graceful
    //     shutdown contract to honor with SIGTERM, and SIGTERM-then-wait
    //     would just let a misbehaving process burn additional wall-clock
    //     before we force the kill anyway.
    //   - Outer (in runDocker): at `timeoutMs + 30_000`, kill the docker
    //     CLI process too — covers the case where `docker kill` itself
    //     hangs (rare; would mean the daemon is in trouble).
    const killTimer = setTimeout(() => {
      // Bounded so a wedged docker daemon doesn't leak the Bun subprocess
      // (audit follow-up F4). Same 5s ceiling as cancelExecution.
      void dockerKill(containerName, 'KILL', { timeoutMs: 5_000 }).catch(
        (err) => {
          console.warn(
            `[sandbox] timeout-triggered dockerKill failed for ${containerName}:`,
            err,
          );
        },
      );
    }, timeoutMs);
    let result: Awaited<ReturnType<typeof runDocker>>;
    try {
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
      result = await runDocker(argv, {
        timeoutMs: timeoutMs + 30_000,
        signal: abort.signal,
        killOnTimeoutContainer: containerName,
        // In-band byte caps prevent a runaway runtime container from OOM'ing
        // the spawner heap; runDocker continues draining the pipe but
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
    } finally {
      clearTimeout(killTimer);
    }

    const durationMs = Date.now() - startedAtMs;
    const exitCode = result.exitCode;

    const stdoutWithoutPhases = stripPhaseMarkers(result.stdout);
    const stdoutClean = stripControlChars(stdoutWithoutPhases);
    const stderrClean = stripControlChars(result.stderr);
    // runDocker now caps reads in-band, but keep capText as a defensive
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
        ? ((await readStepResults(workspaceHostDir, req.steps)) ??
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
        workspaceHostDir,
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
    try {
      await dockerRm(containerName);
    } catch (err) {
      console.warn(
        `[sandbox.cleanup] dockerRm failed for ${containerName}:`,
        err,
      );
    }
    try {
      await rm(workspaceHostDir, { recursive: true, force: true });
    } catch (err) {
      // Loud: silent rm failures = host disk leak. Audit finding.
      console.warn(
        `[sandbox.cleanup] failed to rm host workspace ${workspaceHostDir}:`,
        err,
      );
    }
  }
}

/**
 * Synthesize a `steps[]` payload for the case where the wrapper never
 * produced results.json (container killed during dependency install,
 * spawner-side crash before docker run, etc). Every requested step is
 * recorded as `skipped`. The caller can replace the first entry with a
 * `failed` if the run carries a runtime error code.
 */
function synthesizeStepResults(steps: readonly string[]): SandboxStepResult[] {
  return steps.map((path) => ({
    path,
    status: 'skipped',
    exitCode: null,
    durationMs: 0,
  }));
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

// Strip ANSI CSI / OSC sequences and bare control characters that user
// code (or pip/npm progress bars) emits. Without this, the chat-canvas
// pre-renders raw escape codes as garbage glyphs, and `\r` overwrites
// drag stdout lines into each other in the UI. Done once on the spawner
// side so both the preview and the overflow-storage blob are clean.
//
// Pattern coverage:
//   \x1b\[ ... <final>   — CSI sequences (color, cursor, erase, ...)
//   \x1b\] ... \x07      — OSC sequences (terminator: BEL)
//   \x1b\] ... \x1b\\    — OSC sequences (terminator: ST)
//   \x07                 — bare BEL
//   \r (not \r\n)        — lone carriage return → newline (progress bars)
// Tabs (\t) are deliberately kept; they render fine in the UI.
const ANSI_CSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const ANSI_OSC_BEL_RE = /\x1b\][^\x07]*\x07/g;
const ANSI_OSC_ST_RE = /\x1b\][^\x1b]*\x1b\\/g;
const ESC_AND_CONTROL_RE = /[\x07\x08\x0b\x0c\x0e-\x1a\x1c-\x1f]/g;

function stripControlChars(text: string): string {
  return text
    .replace(ANSI_OSC_BEL_RE, '')
    .replace(ANSI_OSC_ST_RE, '')
    .replace(ANSI_CSI_RE, '')
    .replace(ESC_AND_CONTROL_RE, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
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
