'use node';

/**
 * In-session code execution + output harvest — the shared bottom half every
 * session lane settles through. `runStepsInSession` installs declared
 * packages and runs staged scripts as sequential execs (automation `script`
 * steps, the crawler's render lane); `harvestSessionOutput` reads the
 * session's `/user/output` delivery box into blob storage + `fileMetadata`
 * (automation agent/script hosts, task-agent runs). The CALLER owns the
 * session lifecycle and stages inputs before calling in.
 */

import { createHash, randomUUID } from 'node:crypto';

import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import { orgSlugFromIdOrNull } from '../../lib/helpers/org_slug';
import { deleteBlob, putBlob } from '../../lib/storage/blob_access';
import { convexStorageId, type BlobRef } from '../../lib/storage/blob_ref';
import {
  drainSessionExecResilient,
  sessionIsAlive,
  sessionListFiles,
  sessionReadFile,
} from './helpers/session_client';

/** Runaway-output backstop, NOT a working budget. It sat at 16 and a real
 * run's legitimate delivery reached 18 files — the cap silently dropped the
 * two that listed last (one of them the primary deliverable) and every run
 * then read as "produced nothing". Over-cap files are reported in
 * `harvestSkipped`; consumers surface them, never drop them silently. */
const SANDBOX_MAX_OUTPUT_FILES_PER_RUN = 64;
/** The session's delivery box — harvested (top-level files only) when a work
 * turn settles. Exported so lanes on a STANDING session can sweep leftovers
 * before a new turn (a per-run session dies with its files; a standing one
 * would re-harvest a prior run's deliverables onto the wrong task). */
export const OUTPUT_DIR = '/user/output';

// `inferContentType`/`inferStepLanguage` lived in
// `convex/agent_tools/files/_shared.ts`, moved wholesale with the tool-
// calling/subagent plane. Copied verbatim (single caller — this file) rather
// than re-created as a module; both are pure, no AI dependency (extension →
// MIME / runtime dispatch tables), so this execution path (which has no AI
// dependency of its own either) keeps working unchanged.

/**
 * MIME inference from path extension. Falls back to `application/octet-stream`
 * for unknown extensions.
 */
function inferContentType(path: string): string {
  const lower = path.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot === -1) return 'application/octet-stream';
  const ext = lower.slice(dot + 1);
  switch (ext) {
    case 'html':
    case 'htm':
      return 'text/html; charset=utf-8';
    case 'svg':
      return 'image/svg+xml';
    case 'md':
    case 'markdown':
    case 'mmd':
    case 'mermaid':
      return 'text/markdown; charset=utf-8';
    case 'json':
      return 'application/json; charset=utf-8';
    case 'yaml':
    case 'yml':
      return 'application/yaml; charset=utf-8';
    case 'toml':
      return 'application/toml; charset=utf-8';
    case 'py':
    case 'pyi':
    case 'pyw':
    case 'js':
    case 'cjs':
    case 'mjs':
    case 'ts':
    case 'tsx':
    case 'jsx':
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'css':
    case 'txt':
    case 'log':
      return 'text/plain; charset=utf-8';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'avif':
      return 'image/avif';
    case 'pdf':
      return 'application/pdf';
    case 'csv':
      return 'text/csv; charset=utf-8';
    case 'pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'zip':
      return 'application/zip';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Per-file runtime dispatcher. Maps a path's extension to the sandbox
 * runtime that should execute it. Returns `null` for any extension the
 * sandbox doesn't host an interpreter for.
 */
function inferStepLanguage(path: string): 'python' | 'node' | 'bash' | null {
  const match = path.toLowerCase().match(/\.([a-z0-9]+)$/);
  const ext = match ? match[1] : undefined;
  if (ext === 'py') return 'python';
  if (ext === 'js' || ext === 'cjs' || ext === 'mjs') return 'node';
  if (ext === 'sh') return 'bash';
  return null;
}

/** Read-back ceiling per harvested output file — mirror of the runnerd
 * daemon's FILE_READ_MAX_BYTES (services/sandbox-runtime/daemon/src/main.ts);
 * keep the two in sync. Checked against the listing size BEFORE reading so an
 * oversize output is reported as skipped instead of surfacing as an opaque
 * read failure. */
const HARVEST_READ_MAX_BYTES = 20 * 1024 * 1024;

function formatMb(n: number): string {
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function interpreterCommand(absPath: string): string[] | null {
  const lang = inferStepLanguage(absPath);
  if (lang === 'python') return ['python3', absPath];
  if (lang === 'node') return ['node', absPath];
  if (lang === 'bash') return ['bash', absPath];
  return null;
}

export interface StepRunResult {
  status: 'completed' | 'failed' | 'cancelled';
  exitCode: number | null;
  stdout: string;
  stderr: string;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Install declared packages, then run each step in order (stopping at the first
 * failure), collecting stdout/stderr. Pure session I/O — no `ctx`, no harvest —
 * so every session caller shares the exact run semantics: the automation
 * `script` step host AND the crawler render (which reads `/user/output`
 * straight off the session). The CALLER owns the session lifecycle
 * (create/teardown) and stages inputs before calling this.
 */
export async function runStepsInSession(
  sessionId: string,
  args: {
    /** Absolute `/user/code/<script>` paths to run in order. */
    stepPaths: string[];
    packagesByLang?: { python?: string[]; node?: string[] };
    timeoutMs?: number;
  },
): Promise<StepRunResult> {
  const timeoutMs = args.timeoutMs ?? 30_000;
  const abort = new AbortController();
  const stdoutParts: string[] = [];
  const stderrParts: string[] = [];
  const runExec = async (
    command: string[],
    perTimeout: number,
    // Steps run from /user/code (staging created it — a step implies a staged
    // script). Installs run from the workspace root: /user always exists,
    // while /user/code doesn't on a fresh session with nothing staged (an
    // install-only call), and runnerd rejects a non-existent cwd.
    cwd: '/user/code' | '/user' = '/user/code',
  ) =>
    drainSessionExecResilient(
      sessionId,
      {
        execId: randomUUID(),
        command,
        cwd,
        collectOutput: true,
        timeoutMs: perTimeout,
      },
      abort.signal,
    );

  // Install declared packages first (persist in the session for later runs).
  // Installs get their own budget, floored at 120s — a cold pip/npm resolve
  // rarely fits the 30s interactive default — and capped at the 300s schema
  // max. A failed install fails the whole run: running the steps anyway would
  // surface a confusing downstream ImportError (or, with no steps, report a
  // success that never happened).
  const py = args.packagesByLang?.python ?? [];
  const node = args.packagesByLang?.node ?? [];
  const installTimeoutMs = Math.min(Math.max(timeoutMs, 120_000), 300_000);
  const installs: Array<{ tool: 'pip' | 'npm'; command: string[] }> = [];
  if (py.length > 0) {
    installs.push({
      tool: 'pip',
      command: ['python3', '-m', 'pip', 'install', '--no-input', ...py],
    });
  }
  if (node.length > 0) {
    installs.push({ tool: 'npm', command: ['npm', 'install', '-g', ...node] });
  }
  for (const { tool, command } of installs) {
    const r = await runExec(command, installTimeoutMs, '/user');
    const failed = r.status !== 'completed' || (r.exitCode ?? 0) !== 0;
    // Install-only runs (and failures) surface installer stdout — it carries
    // the resolved versions / the resolver error. Successful script runs drop
    // it so install noise never drowns the script's own stdout; warnings
    // still route to stderr as before.
    if (args.stepPaths.length === 0 || failed) {
      stdoutParts.push(Buffer.from(r.stdoutBase64, 'base64').toString('utf8'));
    }
    stderrParts.push(Buffer.from(r.stderrBase64, 'base64').toString('utf8'));
    if (failed) {
      const detail = r.errorMessage ?? r.errorCode;
      return {
        status: r.status === 'cancelled' ? 'cancelled' : 'failed',
        exitCode: r.exitCode,
        stdout: stdoutParts.join(''),
        stderr: stderrParts.join(''),
        errorCode: 'INSTALL_FAILED',
        errorMessage: `${tool} install failed${
          r.exitCode !== null ? ` (exit ${r.exitCode})` : ''
        }${detail !== undefined ? `: ${detail}` : ''}`,
      };
    }
  }

  // Run each step in order; stop at the first failure.
  let exitCode: number | null = 0;
  let status: 'completed' | 'failed' | 'cancelled' = 'completed';
  for (const absPath of args.stepPaths) {
    const command = interpreterCommand(absPath);
    if (command === null) {
      status = 'failed';
      stderrParts.push(`No interpreter for "${absPath}".`);
      exitCode = 1;
      break;
    }
    const r = await runExec(command, timeoutMs);
    stdoutParts.push(Buffer.from(r.stdoutBase64, 'base64').toString('utf8'));
    stderrParts.push(Buffer.from(r.stderrBase64, 'base64').toString('utf8'));
    exitCode = r.exitCode;
    if (r.status !== 'completed' || (r.exitCode ?? 0) !== 0) {
      status = r.status === 'cancelled' ? 'cancelled' : 'failed';
      break;
    }
  }

  return {
    status,
    exitCode,
    stdout: stdoutParts.join(''),
    stderr: stderrParts.join(''),
  };
}

/** One file harvested out of a session's `/user/output`. */
export interface HarvestedOutputFile {
  path: string;
  storageId: string;
  size: number;
  contentType: string;
}

/**
 * Harvest top-level `/user/output` into blob storage: each file becomes a
 * stored blob plus a `fileMetadata` row (`source: 'agent'`, no documentId —
 * retention-eligible until a consumer such as a workflow `document.create`
 * claims it). Lane-neutral: chat run_code and the automation agent/script
 * hosts all settle their outputs through this one door.
 *
 * A file that CANNOT come back (over the read cap, workspace quota, storage
 * hiccup) is recorded in `harvestSkipped` and never fails the harvest — the
 * work is done; losing the whole result over one oversize deliverable would
 * punish exactly the successful case.
 */
export async function harvestSessionOutput(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    sessionId: string;
    /** Harvest THIS directory instead of the session-wide delivery box — a
     * STANDING session serving several subjects (the task-agent lane) scopes
     * each turn to its own subdir so one subject's harvest can never pick up
     * another's deliverables. Per-run/turn sessions keep the default. */
    outputDir?: string;
    /** The turn whose settle this harvest belongs to. When set, the loop
     * renews the op's liveness lease once per file — the harvest is the one
     * settle step that can legitimately run for minutes, and without the
     * bumps the recovery sweep would read a working settle as a dead chain
     * and re-attach a second one. */
    execId?: string;
  },
): Promise<{
  files: HarvestedOutputFile[];
  harvestSkipped: Array<{ path: string; reason: string }>;
}> {
  const { sessionId, organizationId, execId } = args;
  const outputDir = args.outputDir ?? OUTPUT_DIR;
  // Backend routing for harvested outputs: the org's own bucket when
  // configured, else Convex `_storage` (also the unresolvable-slug fallback).
  const orgSlug = await orgSlugFromIdOrNull(ctx, organizationId);

  const files: HarvestedOutputFile[] = [];
  const harvestSkipped: Array<{ path: string; reason: string }> = [];
  let entries = await sessionListFiles(sessionId, outputDir);
  if (entries === null) {
    // A 404 is ambiguous for a per-turn SUBDIR: the daemon answers it both
    // for "the turn never created its output dir" (a genuinely empty harvest)
    // AND for "the session itself is gone" (evicted, spawner restarted). Only
    // the session-level probe tells them apart — a dead session must fail
    // loud, or an infra fault settles as a clean "produced nothing".
    if (outputDir !== OUTPUT_DIR) {
      if (await sessionIsAlive(sessionId)) return { files, harvestSkipped };
      throw new Error(
        `sandbox output listing came back 404 for ${outputDir} and the session is gone — its deliverables were lost before harvest`,
      );
    }
    // The top-level delivery box is pre-created by the session entrypoint, so
    // a 404 here means the session (or its box) was gone AT HARVEST TIME —
    // silently treating that as "no outputs" launders an infra fault into a
    // clean-looking empty delivery (a run whose script demonstrably wrote
    // files then "produced nothing"). Fail loud; the step surfaces it.
    throw new Error(
      `sandbox output listing came back 404 for ${outputDir} — the session or its delivery box disappeared before harvest`,
    );
  }
  if (entries.length === 0) {
    // An EMPTY listing right after an exec that reported success is usually a
    // read-after-write race on the session's delivery box, not a script that
    // wrote nothing (scripts that write nothing are rare and retrying costs
    // milliseconds). Re-list briefly before accepting emptiness as truth.
    for (let attempt = 0; attempt < 3 && entries.length === 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const again = await sessionListFiles(sessionId, outputDir);
      if (again === null) {
        // The dir listed fine moments ago and now 404s — the session died
        // mid-settle. Never coerce this back to "empty": that is the one
        // bypass of the loud-404 rule above.
        throw new Error(
          `sandbox output listing came back 404 for ${outputDir} during the empty-listing retry — the session disappeared mid-harvest`,
        );
      }
      entries = again;
    }
    if (entries.length > 0) {
      console.warn(
        `[sandbox] output listing for ${outputDir} was empty on first read and recovered on retry — read-after-write race`,
      );
    }
  }
  for (const e of entries) {
    if (e.type !== 'file') continue;
    const absPath = `${outputDir}/${e.name}`;
    if (files.length >= SANDBOX_MAX_OUTPUT_FILES_PER_RUN) {
      harvestSkipped.push({
        path: absPath,
        reason: `over the ${SANDBOX_MAX_OUTPUT_FILES_PER_RUN}-file per-run harvest cap`,
      });
      continue;
    }
    if (e.size > HARVEST_READ_MAX_BYTES) {
      harvestSkipped.push({
        path: absPath,
        reason: `${formatMb(e.size)} exceeds the ${formatMb(
          HARVEST_READ_MAX_BYTES,
        )} per-file harvest cap — split the output or have the user download it another way`,
      });
      continue;
    }
    if (execId !== undefined) {
      // Lease renewal per file: read + store below are bounded (30s client
      // timeout) but a many-file harvest as a whole is not. Best-effort — a
      // missed bump only hastens a takeover verdict, never corrupts one.
      await ctx
        .runMutation(
          internal.sandbox.session_mutations.bumpSessionOpHeartbeat,
          {
            sessionId,
            execId,
          },
        )
        .catch((err) =>
          console.warn('[session_exec] harvest lease bump failed:', err),
        );
    }
    const read = await sessionReadFile(sessionId, absPath);
    if (read === null) {
      harvestSkipped.push({
        path: absPath,
        reason: 'read from sandbox failed',
      });
      continue;
    }
    const buf = Buffer.from(read.bytes);
    const sha256 = createHash('sha256').update(buf).digest('hex');
    // The unchanged-file dedup consulted the thread-file index, which is
    // offline while the chat backend is rebuilt — every harvested file is
    // stored fresh. Costs duplicate blobs on re-runs, never correctness;
    // the retention sweep reclaims unclaimed outputs.
    // The spawner serves the generic octet-stream — fall back to the
    // extension-derived type (sessionReadFile's documented contract). The
    // Blob MUST carry a non-empty type: the self-hosted backend rejects a
    // type-less storage upload with `BadHeader` ("Error uploading file:
    // … invalid HTTP header"), which failed every harvest of a real output
    // file (e.g. a generated .pptx).
    const contentType =
      read.contentType && read.contentType !== 'application/octet-stream'
        ? read.contentType
        : inferContentType(absPath);
    // Backend-aware store: harvested outputs are org-user-persistent thread
    // files — a BYO-bucket org's outputs land in its own bucket.
    const ab = new ArrayBuffer(buf.byteLength);
    new Uint8Array(ab).set(buf);
    const harvestBytes = new Uint8Array(ab);
    let storageId: BlobRef | null = null;
    try {
      if (orgSlug !== null) {
        storageId = await putBlob(ctx, orgSlug, harvestBytes, contentType);
      } else {
        storageId = await ctx.storage.store(
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a Uint8Array is a valid BlobPart at runtime (TS 5.7 ArrayBufferLike variance)
          new Blob([harvestBytes as BlobPart], { type: contentType }),
        );
      }
      // The thread-file mirror row is chat-thread bookkeeping; its module
      // is offline while the chat backend is rebuilt. The blob above and the
      // fileMetadata row below still land, so run outputs stay retrievable.
      console.debug(
        `[session_exec] thread-file mirror skipped for ${absPath} (session ${sessionId}, sha ${sha256.slice(0, 8)}) — chat backend offline`,
      );
    } catch (err) {
      // Quota/validation rejection after the blob copy — reap the orphan
      // (mirrors workspace_uploads' filing reap).
      if (storageId !== null) {
        try {
          const copyConvexId = convexStorageId(storageId);
          if (copyConvexId !== null) {
            await ctx.storage.delete(copyConvexId);
          } else if (orgSlug !== null) {
            await deleteBlob(ctx, orgSlug, storageId);
          }
        } catch (delErr) {
          console.warn('[session_exec] harvest orphan cleanup failed:', delErr);
        }
      }
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[session_exec] harvest skipped ${absPath}: ${message}`);
      harvestSkipped.push({
        path: absPath,
        reason: `not saved to the workspace: ${message}`,
      });
      continue;
    }
    // A fileMetadata row per harvested blob (was a documented follow-up): a
    // follow-up consumer of the storage id — e.g. a workflow `document.create`
    // filing a produced artifact — resolves name/type through fileMetadata and
    // would otherwise fail on "metadata not found". source 'agent' with no
    // documentId keeps unclaimed outputs eligible for the retention sweep;
    // document.create back-fills the documentId link when a file is claimed.
    // Best-effort: a metadata failure must not fail the whole harvest.
    try {
      await ctx.runMutation(
        internal.file_metadata.internal_mutations.saveFileMetadata,
        {
          organizationId,
          // Blob reference string — saveFileMetadata is blobRef-wide.
          storageId,
          fileName: e.name,
          contentType,
          size: buf.byteLength,
          source: 'agent',
        },
      );
    } catch (metaErr) {
      console.warn('[session_exec] saveFileMetadata failed:', metaErr);
    }
    files.push({
      path: absPath,
      storageId: String(storageId),
      size: buf.byteLength,
      contentType,
    });
  }

  return { files, harvestSkipped };
}
