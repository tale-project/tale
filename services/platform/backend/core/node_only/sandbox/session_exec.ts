'use node';

/**
 * In-session code execution + output harvest — the shared bottom half every
 * session lane settles through. `runStepsInSession` runs staged scripts as
 * sequential execs (the crawler's render lane); `harvestSessionOutput` reads
 * the session's `/agent/output` delivery box into the org bucket +
 * `fileMetadata` (automation agent hosts, task-agent runs). The CALLER owns
 * the session lifecycle and stages inputs before calling in.
 */

import { randomUUID } from 'node:crypto';

import type { ActionCtx } from '../../lib/ctx';
import { internal } from '../../lib/handler_names';
import { orgSlugFromIdOrNull } from '../../lib/helpers/org_slug';
import { putBlob } from '../../lib/storage/blob_access';
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
export const OUTPUT_DIR = '/agent/output';

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
    case 'patch':
    case 'diff':
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
 * Run each staged step in order (stopping at the first failure), collecting
 * stdout/stderr. Pure session I/O — no `ctx`, no harvest. The one caller is
 * the crawler render lane (which reads `/agent/output` straight off the
 * session); it stages its scripts, so every step runs from `/agent/code`.
 * The CALLER owns the session lifecycle (create/teardown) and stages inputs
 * before calling this. Package installs were a lane for automation `script`
 * steps, which never landed in 0.5 — a consumer that needs them adds them
 * with its own budget.
 */
export async function runStepsInSession(
  sessionId: string,
  args: {
    /** Absolute `/agent/code/<script>` paths to run in order. */
    stepPaths: string[];
    timeoutMs?: number;
  },
): Promise<StepRunResult> {
  const timeoutMs = args.timeoutMs ?? 30_000;
  const abort = new AbortController();
  const stdoutParts: string[] = [];
  const stderrParts: string[] = [];
  const runExec = async (command: string[]) =>
    drainSessionExecResilient(
      sessionId,
      {
        execId: randomUUID(),
        command,
        cwd: '/agent/code',
        collectOutput: true,
        timeoutMs,
      },
      abort.signal,
    );

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
    const r = await runExec(command);
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

/** One file harvested out of a session's `/agent/output`. */
export interface HarvestedOutputFile {
  path: string;
  storageId: string;
  size: number;
  contentType: string;
}

/**
 * Harvest top-level `/agent/output` into the org's bucket: each file becomes
 * a stored blob plus a `fileMetadata` row (`source: 'agent'`, no documentId
 * — retention-eligible until a consumer such as a workflow `document.create`
 * claims it). Lane-neutral: the task-agent and automation agent hosts settle
 * their outputs through this one door.
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
  // Harvested outputs land in the org's own bucket (`putBlob` routes a
  // BYO-bucket org to its bucket). There is no other store: an org whose
  // slug does not resolve is an infra fault (deleted mid-run), and a harvest
  // that quietly skipped every file would launder it into "produced
  // nothing" — fail loud before touching the session, like the 404s below.
  const orgSlug = await orgSlugFromIdOrNull(ctx, organizationId);
  if (orgSlug === null) {
    throw new Error(
      `sandbox output harvest for session ${sessionId} has no bucket: organization ${organizationId} does not resolve to a slug`,
    );
  }

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
    // Every harvested file is stored fresh (no unchanged-file dedup). Costs
    // duplicate blobs on re-runs, never correctness; the retention sweep
    // reclaims unclaimed outputs.
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
    // files — a BYO-bucket org's outputs land in its own bucket. A rejected
    // store (quota, validation) leaves no blob behind to reap.
    const ab = new ArrayBuffer(buf.byteLength);
    new Uint8Array(ab).set(buf);
    const harvestBytes = new Uint8Array(ab);
    let storageId: string;
    try {
      storageId = await putBlob(ctx, orgSlug, harvestBytes, contentType);
    } catch (err) {
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
      storageId,
      size: buf.byteLength,
      contentType,
    });
  }

  return { files, harvestSkipped };
}
