'use node';

/**
 * Run chat `run_code` inside the thread's TURN-scoped sandbox session: one
 * session amortizes all run_code calls of a turn (create once, warm HTTP
 * execs after), and `runGenerationCore`'s finally destroys it when the turn
 * ends — it never idles across turns.
 *
 * This is the sole chat `run_code` execution path — `run_code_tool` calls it
 * directly (the ephemeral one-shot path is no longer used by chat). An error
 * here surfaces to the model as a run_code failure.
 *
 * v1 scope (validate against a live session, then harden): single- and
 * multi-step scripts + package install run as sequential in-session execs;
 * harvest reads top-level `/user/output` files and upserts only new/changed
 * ones (sha256) — within a turn the workspace stays warm, so prior outputs
 * already live there and the per-call re-stage/re-harvest churn of the
 * ephemeral path is gone. Known follow-ups: nested output dirs, a
 * `fileMetadata` row per output (as the ephemeral path writes via
 * `insertOutputFiles`), and a durable `sandboxSessionOps` audit row.
 */

import { createHash, randomUUID } from 'node:crypto';

import { v } from 'convex/values';

import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import { internalAction, type ActionCtx } from '../../_generated/server';
import {
  inferContentType,
  inferStepLanguage,
} from '../../agent_tools/files/_shared';
import { toSandboxStorageUrl } from '../../lib/helpers/public_storage_url';
import {
  drainSessionExecResilient,
  sessionListFiles,
  sessionReadFile,
  sessionStageFiles,
} from './helpers/session_client';

const SANDBOX_MAX_OUTPUT_FILES_PER_RUN = 16;
const OUTPUT_DIR = '/user/output';

// Explicit return type — the handler references `internal` (which transitively
// includes this action), so TS cannot infer its return type without a cycle.
export interface SessionExecResultShape {
  executionId: string;
  status: 'completed' | 'failed' | 'cancelled';
  exitCode: number | null;
  stdoutPreview: string;
  stderrPreview: string;
  durationMs: number;
  files: Array<{
    path: string;
    storageId: string;
    size: number;
    contentType: string;
  }>;
}

function interpreterCommand(absPath: string): string[] | null {
  const lang = inferStepLanguage(absPath);
  if (lang === 'python') return ['python3', absPath];
  if (lang === 'node') return ['node', absPath];
  if (lang === 'bash') return ['bash', absPath];
  return null;
}

/** Strip the `/user/` mount prefix — `sessionStageFiles` paths are relative to
 *  the workspace root (`/user`). `/user/code/gen.py` → `code/gen.py`. */
export function stagePathOf(absolutePath: string): string {
  return absolutePath.replace(/^\/user\//, '');
}

export interface StepRunResult {
  status: 'completed' | 'failed' | 'cancelled';
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Install declared packages, then run each step in order (stopping at the first
 * failure), collecting stdout/stderr. Pure session I/O — no `ctx`, no harvest —
 * so every session caller shares the exact run semantics: the threadFiles
 * harvest (`runAndHarvestInSession`, below) AND the crawler render (which reads
 * `/user/output` straight off the session). The CALLER owns the session
 * lifecycle (create/teardown) and stages inputs before calling this.
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
  const runExec = async (command: string[], perTimeout: number) =>
    drainSessionExecResilient(
      sessionId,
      {
        execId: randomUUID(),
        command,
        cwd: '/user/code',
        collectOutput: true,
        timeoutMs: perTimeout,
      },
      abort.signal,
    );

  // Install declared packages first (persist in the session for later runs).
  const py = args.packagesByLang?.python ?? [];
  const node = args.packagesByLang?.node ?? [];
  if (py.length > 0) {
    const r = await runExec(
      ['python3', '-m', 'pip', 'install', '--no-input', ...py],
      Math.min(timeoutMs, 300_000),
    );
    stderrParts.push(Buffer.from(r.stderrBase64, 'base64').toString('utf8'));
  }
  if (node.length > 0) {
    const r = await runExec(
      ['npm', 'install', '-g', ...node],
      Math.min(timeoutMs, 300_000),
    );
    stderrParts.push(Buffer.from(r.stderrBase64, 'base64').toString('utf8'));
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

/**
 * Session-exec + threadFiles harvest: run `stepPaths` via {@link
 * runStepsInSession}, then harvest top-level `/user/output` — storing only
 * new/changed files (sha256) into Convex storage and upserting them as
 * `run_output` threadFiles keyed by `workspaceThreadId`. The CALLER owns the
 * session lifecycle and stages inputs. Used by chat run_code (per-thread
 * session) and workflow script steps (per-run session).
 *
 * Explicit return type — like the action below, it references `internal`, so TS
 * can't infer the type without a cycle.
 */
export async function runAndHarvestInSession(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    /** threadFiles owner key for harvested outputs — a threadId (chat) or a
     * workflow executionId (workflow script step). */
    workspaceThreadId: string;
    sessionId: string;
    /** Absolute `/user/code/<script>` paths to run in order. */
    stepPaths: string[];
    packagesByLang?: { python?: string[]; node?: string[] };
    timeoutMs?: number;
  },
): Promise<SessionExecResultShape> {
  const startedAt = Date.now();
  const execId = randomUUID();
  const { sessionId, workspaceThreadId, organizationId } = args;

  const run = await runStepsInSession(sessionId, {
    stepPaths: args.stepPaths,
    ...(args.packagesByLang !== undefined && {
      packagesByLang: args.packagesByLang,
    }),
    ...(args.timeoutMs !== undefined && { timeoutMs: args.timeoutMs }),
  });

  // Harvest top-level /user/output, upserting only new/changed files (sha256).
  const files: Array<{
    path: string;
    storageId: string;
    size: number;
    contentType: string;
  }> = [];
  const entries = (await sessionListFiles(sessionId, OUTPUT_DIR)) ?? [];
  for (const e of entries) {
    if (e.type !== 'file') continue;
    if (files.length >= SANDBOX_MAX_OUTPUT_FILES_PER_RUN) break;
    const absPath = `${OUTPUT_DIR}/${e.name}`;
    const read = await sessionReadFile(sessionId, absPath);
    if (read === null) continue;
    const buf = Buffer.from(read.bytes);
    const sha256 = createHash('sha256').update(buf).digest('hex');
    const existing = await ctx.runQuery(
      internal.thread_files.internal_queries.getThreadFileByPath,
      { threadId: workspaceThreadId, path: absPath },
    );
    if (existing !== null && existing.sha256 === sha256) continue; // unchanged
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
    const ab = new ArrayBuffer(buf.byteLength);
    new Uint8Array(ab).set(buf);
    const storageId = await ctx.storage.store(
      new Blob([ab], { type: contentType }),
    );
    await ctx.runMutation(
      internal.thread_files.internal_mutations.upsertThreadFile,
      {
        organizationId,
        threadId: workspaceThreadId,
        path: absPath,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- storage id branded at runtime
        storageId: storageId as Id<'_storage'>,
        size: buf.byteLength,
        contentType,
        sha256,
        source: 'run_output' as const,
      },
    );
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
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- storage id branded at runtime
          storageId: storageId as Id<'_storage'>,
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

  return {
    executionId: execId,
    status: run.status,
    exitCode: run.exitCode,
    stdoutPreview: run.stdout.slice(0, 4096),
    stderrPreview: run.stderr.slice(0, 4096),
    durationMs: Date.now() - startedAt,
    files,
  };
}

export const executeCodeInSession = internalAction({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    uploadedBy: v.string(),
    // Absolute /user/code/<script> paths (already validated by run_code_tool).
    stepPaths: v.array(v.string()),
    packagesByLang: v.optional(
      v.object({
        python: v.optional(v.array(v.string())),
        node: v.optional(v.array(v.string())),
      }),
    ),
    timeoutMs: v.optional(v.number()),
  },
  returns: v.object({
    executionId: v.string(),
    status: v.union(
      v.literal('completed'),
      v.literal('failed'),
      v.literal('cancelled'),
    ),
    exitCode: v.union(v.number(), v.null()),
    stdoutPreview: v.string(),
    stderrPreview: v.string(),
    durationMs: v.number(),
    files: v.array(
      v.object({
        path: v.string(),
        storageId: v.string(),
        size: v.number(),
        contentType: v.string(),
      }),
    ),
  }),
  handler: async (ctx, args): Promise<SessionExecResultShape> => {
    const { sessionId, created } = await ctx.runAction(
      internal.node_only.sandbox.thread_session.ensureThreadSession,
      {
        organizationId: args.organizationId,
        threadId: args.threadId,
        createdBy: args.uploadedBy,
      },
    );

    // Stage inputs. On a fresh session, reconstruct the whole workspace from
    // threadFiles; on a warm/resumed one, only re-stage the mutable inputs
    // (scripts/uploads) — prior `run_output` files persist in the workspace.
    const rows = await ctx.runQuery(
      internal.thread_files.internal_queries.listThreadFiles,
      { threadId: args.threadId },
    );
    const toStage: { path: string; url: string }[] = [];
    for (const r of rows as Array<{
      organizationId: string;
      path: string;
      storageId: Id<'_storage'>;
      source: 'user_upload' | 'agent_write' | 'run_output';
    }>) {
      if (r.organizationId !== args.organizationId) continue;
      if (r.source === 'run_output' && !created) continue;
      const raw = await ctx.storage.getUrl(r.storageId);
      if (raw === null) continue;
      toStage.push({
        path: stagePathOf(r.path),
        url: toSandboxStorageUrl(raw),
      });
    }
    if (toStage.length > 0) {
      await sessionStageFiles(sessionId, toStage);
    }

    return runAndHarvestInSession(ctx, {
      organizationId: args.organizationId,
      workspaceThreadId: args.threadId,
      sessionId,
      stepPaths: args.stepPaths,
      ...(args.packagesByLang !== undefined && {
        packagesByLang: args.packagesByLang,
      }),
      ...(args.timeoutMs !== undefined && { timeoutMs: args.timeoutMs }),
    });
  },
});
