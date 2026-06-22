'use node';

// Sandbox node actions for the new thread-workspace model.
//
// `executeCode` is invoked by the `run_code` LLM tool. It:
//   1. Reads the calling thread's workspace files (threadFiles table) and
//      mounts each one at /user/code/<path> in the sandbox container.
//   2. Reserves a sandboxExecutions audit row (atomic quota + insert).
//   3. Hands the spawner pre-signed `_storage` upload URLs so it can POST
//      harvested output files directly into Convex storage.
//   4. After the spawner finishes, inserts a fileMetadata row per output
//      AND upserts each output into `threadFiles` (source 'run_output')
//      so the canvas + future `file_read` calls see them.
//   5. Finalizes the audit row.
//
// Failure rule: infrastructure throws propagate; user-code failures
// (exit ≠ 0, install failure, sandbox timeout, OOM) return a structured
// result so the LLM can react.

import { ConvexError, v } from 'convex/values';

import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import { internalAction, type ActionCtx } from '../../_generated/server';
import { toSandboxStorageUrl } from '../../lib/helpers/public_storage_url';
import {
  SANDBOX_DEFAULT_TIMEOUT_MS,
  SANDBOX_MAX_OUTPUT_FILES_PER_RUN,
  SANDBOX_MAX_TIMEOUT_MS,
  SANDBOX_OUTPUT_UPLOAD_SLOTS_PREALLOC,
  SANDBOX_STDERR_PREVIEW_MAX,
  SANDBOX_STDOUT_PREVIEW_MAX,
} from '../../sandbox/schema';
import {
  sandboxErrorCodeValidator,
  sandboxLanguageValidator,
  sandboxStepResultValidator,
  type SandboxErrorCode,
  type SandboxStepResult,
} from '../../sandbox/wire';
import {
  sessionBrowserClosePages,
  sessionCancelExec,
} from './helpers/session_client';
import { spawnerCancel, spawnerExecute } from './helpers/spawner_client';

type ExecuteCodeResult = {
  executionId: Id<'sandboxExecutions'>;
  success: boolean;
  status: 'completed' | 'failed' | 'cancelled';
  exitCode: number | null;
  errorCode?: SandboxErrorCode;
  errorMessage?: string;
  stdoutPreview: string;
  stderrPreview: string;
  durationMs: number;
  truncated: { stdout: boolean; stderr: boolean; files: number };
  files: Array<{
    path: string;
    storageId: Id<'_storage'>;
    size: number;
    contentType: string;
  }>;
  steps?: SandboxStepResult[];
};

async function rollbackUploadedBlobs(
  ctx: { storage: { delete: (id: Id<'_storage'>) => Promise<void> } },
  ids: Set<string>,
): Promise<void> {
  for (const sid of ids) {
    try {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- delete needs Id<'_storage'>
      await ctx.storage.delete(sid as unknown as Id<'_storage'>);
    } catch (err) {
      console.warn(`[sandbox] storage.delete(${sid}) failed:`, err);
    }
  }
  ids.clear();
}

async function failExecution(
  ctx: ActionCtx,
  executionId: Id<'sandboxExecutions'>,
  uploadedStorageIds: Set<string>,
  startedAt: number,
  status: 'failed' | 'cancelled',
  errorCode: SandboxErrorCode,
  errorMessage: string,
  extra?: {
    stdoutPreview?: string;
    stderrPreview?: string;
    exitCode?: number | null;
  },
): Promise<ExecuteCodeResult> {
  const durationMs = Date.now() - startedAt;
  await rollbackUploadedBlobs(ctx, uploadedStorageIds);
  try {
    await ctx.runMutation(internal.sandbox.internal_mutations.finalize, {
      executionId,
      status,
      errorCode,
      errorMessage,
      ...(extra?.stdoutPreview !== undefined && {
        stdoutPreview: extra.stdoutPreview,
      }),
      ...(extra?.stderrPreview !== undefined && {
        stderrPreview: extra.stderrPreview,
      }),
      ...(extra?.exitCode !== undefined &&
        extra.exitCode !== null && { exitCode: extra.exitCode }),
      outputFiles: [],
      durationMs,
      actualSeconds: durationMs / 1000,
    });
  } catch (err) {
    console.warn(`[sandbox.failExecution] audit finalize failed:`, err);
  }
  return {
    executionId,
    success: false,
    status,
    exitCode: extra?.exitCode ?? null,
    errorCode,
    errorMessage,
    stdoutPreview: extra?.stdoutPreview ?? '',
    stderrPreview: extra?.stderrPreview ?? '',
    durationMs,
    truncated: { stdout: false, stderr: false, files: 0 },
    files: [],
  };
}

export const executeCode = internalAction({
  args: {
    organizationId: v.string(),
    uploadedBy: v.string(),
    threadId: v.string(),
    messageId: v.optional(v.string()),
    toolCallId: v.optional(v.string()),
    agentSlug: v.optional(v.string()),
    language: sandboxLanguageValidator,
    /**
     * Files staged at /user/code/<path>. Each entry carries an
     * internal Caddy URL the spawner GETs to fetch the bytes — keeps the
     * wire binary-safe (PPTX / XLSX / PNG etc. survive intact) and bypasses
     * the spawner body cap. Caller mints URLs via `ctx.storage.getUrl` +
     * `toSandboxStorageUrl`.
     */
    files: v.array(v.object({ path: v.string(), url: v.string() })),
    /**
     * Files staged at /user/output/<name>. Reserved for thread files
     * with `source: 'run_output'` (i.e. produced by previous `run_code`
     * invocations); the spawner pre-populates them so the agent can read
     * historical artifacts from a stable path.
     */
    priorOutputDownloads: v.optional(
      v.array(v.object({ name: v.string(), url: v.string() })),
    ),
    /**
     * Files staged at /user/uploads/<name>. Reserved for thread files
     * with `source: 'user_upload'`. Kept disjoint from
     * `priorOutputDownloads` so user-uploaded raw assets never get mixed
     * with code-output artifacts.
     */
    userUploadDownloads: v.optional(
      v.array(v.object({ name: v.string(), url: v.string() })),
    ),
    entryPath: v.optional(v.string()),
    steps: v.optional(v.array(v.string())),
    packages: v.optional(v.array(v.string())),
    packagesByLang: v.optional(
      v.object({
        python: v.optional(v.array(v.string())),
        node: v.optional(v.array(v.string())),
      }),
    ),
    timeoutMs: v.optional(v.number()),
    /**
     * Step-scoped env injected into the runtime process. Only the workflow
     * `sandbox` script path sets this (resolved/templated upstream); the
     * run_code LLM tool leaves it undefined. The spawner sanitizes it.
     */
    env: v.optional(v.record(v.string(), v.string())),
    purpose: v.string(),
    /** Optional skill provenance — recorded on the audit row only. */
    sourceCitationSkillSlug: v.optional(v.string()),
    sourceCitationFiles: v.optional(v.array(v.string())),
  },
  returns: v.object({
    executionId: v.id('sandboxExecutions'),
    success: v.boolean(),
    status: v.union(
      v.literal('completed'),
      v.literal('failed'),
      v.literal('cancelled'),
    ),
    exitCode: v.union(v.number(), v.null()),
    errorCode: v.optional(sandboxErrorCodeValidator),
    errorMessage: v.optional(v.string()),
    stdoutPreview: v.string(),
    stderrPreview: v.string(),
    durationMs: v.number(),
    truncated: v.object({
      stdout: v.boolean(),
      stderr: v.boolean(),
      files: v.number(),
    }),
    files: v.array(
      v.object({
        path: v.string(),
        storageId: v.id('_storage'),
        size: v.number(),
        contentType: v.string(),
      }),
    ),
    steps: v.optional(v.array(sandboxStepResultValidator)),
  }),
  handler: async (ctx, args): Promise<ExecuteCodeResult> => {
    const entryProvided = args.entryPath !== undefined;
    const stepsProvided = args.steps !== undefined && args.steps.length > 0;
    if (entryProvided === stepsProvided) {
      throw new ConvexError({
        code: 'INPUT_REJECTED',
        message:
          'executeCode requires exactly one of `entryPath` or `steps` (non-empty).',
      });
    }
    if (args.files.length === 0) {
      throw new ConvexError({
        code: 'INPUT_REJECTED',
        message: 'executeCode requires `files[]` carrying the script contents.',
      });
    }
    const timeoutMs = Math.min(
      Math.max(args.timeoutMs ?? SANDBOX_DEFAULT_TIMEOUT_MS, 1_000),
      SANDBOX_MAX_TIMEOUT_MS,
    );
    const estimatedSeconds = Math.ceil(timeoutMs / 1000);

    // Audit-row codePreview: post-URL-ingress the file bytes no longer
    // travel through this action (only URLs do), so the preview is now a
    // synthesized label for both single-script and multi-step. The full
    // code is recoverable via threadFiles + storageId for forensic needs.
    const sourceForPreview = entryProvided
      ? `[single-script] ${args.entryPath ?? '<unknown>'}`
      : `[multi-step] ${args.steps?.join(' → ') ?? ''}`;

    let executionId: Id<'sandboxExecutions'>;
    try {
      executionId = await ctx.runMutation(
        internal.sandbox.internal_mutations.reserveSlotAndInsert,
        {
          organizationId: args.organizationId,
          uploadedBy: args.uploadedBy,
          threadId: args.threadId,
          ...(args.messageId !== undefined && { messageId: args.messageId }),
          ...(args.toolCallId !== undefined && { toolCallId: args.toolCallId }),
          ...(args.agentSlug !== undefined && { agentSlug: args.agentSlug }),
          ...(args.sourceCitationSkillSlug !== undefined && {
            skillSlug: args.sourceCitationSkillSlug,
          }),
          path: args.entryPath ?? args.steps?.[0] ?? '<unknown>',
          language: args.language,
          purpose: args.purpose,
          codePreview: sourceForPreview.slice(0, 8 * 1024),
          packages: [
            ...(args.packages ?? []),
            ...(args.packagesByLang?.python ?? []),
            ...(args.packagesByLang?.node ?? []),
          ],
          estimatedSeconds,
        },
      );
    } catch (err) {
      if (
        err instanceof ConvexError &&
        typeof err.data === 'object' &&
        err.data !== null &&
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ConvexError data shape is loose
        (err.data as { code?: string }).code === 'QUOTA_EXCEEDED'
      ) {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shape-narrowed
        const data = err.data as { message?: string };
        throw new ConvexError({
          code: 'QUOTA_EXCEEDED',
          message: data.message ?? 'Sandbox quota exceeded',
        });
      }
      throw err;
    }

    const startedAt = Date.now();
    const uploadedStorageIds = new Set<string>();
    const abort = new AbortController();

    try {
      await ctx.runMutation(internal.sandbox.internal_mutations.setRunning, {
        executionId,
        status: 'installing',
      });
    } catch (err) {
      return failExecution(
        ctx,
        executionId,
        uploadedStorageIds,
        startedAt,
        'failed',
        'SPAWNER_UNAVAILABLE',
        `failed to flip audit row to installing: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Pre-allocate output upload slots so the spawner can POST harvested
    // files directly into Convex storage.
    const preAllocSlots: Array<{ url: string }> = [];
    try {
      for (let i = 0; i < SANDBOX_OUTPUT_UPLOAD_SLOTS_PREALLOC; i += 1) {
        const raw = await ctx.storage.generateUploadUrl();
        preAllocSlots.push({ url: toSandboxStorageUrl(raw) });
      }
    } catch (err) {
      return failExecution(
        ctx,
        executionId,
        uploadedStorageIds,
        startedAt,
        'failed',
        'SPAWNER_UNAVAILABLE',
        `failed to pre-allocate output upload slots: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const remainingQuota =
      SANDBOX_MAX_OUTPUT_FILES_PER_RUN - preAllocSlots.length;
    try {
      await ctx.runMutation(
        internal.sandbox.internal_mutations.applyInitOutputSlots,
        {
          executionId,
          slots: preAllocSlots.map((s) => s.url),
          quotaRemaining: remainingQuota,
        },
      );
    } catch (err) {
      console.warn('[sandbox.executeCode] applyInitOutputSlots failed:', err);
    }

    const storageBase = (
      process.env.SANDBOX_STORAGE_INTERNAL_BASE_URL ??
      process.env.SITE_URL ??
      'http://127.0.0.1:3210'
    ).replace(/\/$/, '');
    const httpApiBase = (
      process.env.SANDBOX_HTTP_API_BASE_URL ??
      storageBase.replace(/:3210(\/|$)/, ':3211$1')
    ).replace(/\/$/, '');
    const outputUrlEndpoint = `${httpApiBase}/api/sandbox/output_upload_url`;
    const reportUploadedEndpoint = `${httpApiBase}/api/sandbox/record_uploaded`;

    let spawnerResult;
    try {
      spawnerResult = await spawnerExecute(
        {
          executionId: String(executionId),
          organizationId: args.organizationId,
          language: args.language,
          files: args.files,
          ...(args.priorOutputDownloads !== undefined &&
            args.priorOutputDownloads.length > 0 && {
              priorOutputDownloads: args.priorOutputDownloads,
            }),
          ...(args.userUploadDownloads !== undefined &&
            args.userUploadDownloads.length > 0 && {
              userUploadDownloads: args.userUploadDownloads,
            }),
          ...(args.entryPath !== undefined && { entryPath: args.entryPath }),
          ...(args.steps !== undefined &&
            args.steps.length > 0 && { steps: args.steps }),
          ...(args.packages !== undefined && { packages: args.packages }),
          ...(args.packagesByLang !== undefined && {
            packagesByLang: args.packagesByLang,
          }),
          ...(args.env !== undefined &&
            Object.keys(args.env).length > 0 && { env: args.env }),
          outputUploadSlots: preAllocSlots,
          outputUrlEndpoint,
          reportUploadedEndpoint,
          timeoutMs,
        },
        abort.signal,
        {
          // Blue-green: persist the colour the spawner landed on so a
          // concurrent user-Stop routes its cancel to the SAME colour even
          // after a deploy flip. Best-effort — a failed patch just falls back
          // to the bare `sandbox` alias on cancel.
          onSpawnerColor: async (color) => {
            await ctx
              .runMutation(
                internal.sandbox.internal_mutations.setSpawnerColor,
                { executionId, spawnerColor: color },
              )
              .catch((err: unknown) => {
                console.warn(
                  `[sandbox.executeCode] setSpawnerColor failed (continuing):`,
                  err,
                );
              });
          },
        },
      );
    } catch (err) {
      return failExecution(
        ctx,
        executionId,
        uploadedStorageIds,
        startedAt,
        'failed',
        'SPAWNER_UNAVAILABLE',
        err instanceof Error ? err.message : String(err),
      );
    }

    // Register each harvested file in fileMetadata + threadFiles.
    const stagedForInsert: Array<{
      name: string;
      storageId: Id<'_storage'>;
      size: number;
      contentType: string;
      sha256: string;
    }> = [];
    for (const f of spawnerResult.outputFiles) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- spawner storageId branded at the wire layer
      const storageId = f.storageId as unknown as Id<'_storage'>;
      uploadedStorageIds.add(String(storageId));
      stagedForInsert.push({
        name: f.name,
        storageId,
        size: f.size,
        contentType: f.contentType,
        sha256: f.sha256,
      });
    }

    const insertResult = await ctx.runMutation(
      internal.sandbox.output_mutations.insertOutputFiles,
      {
        executionId,
        organizationId: args.organizationId,
        threadId: args.threadId,
        uploadedBy: args.uploadedBy,
        files: stagedForInsert,
      },
    );
    if (insertResult.skippedTerminal) {
      console.warn(
        `[sandbox.executeCode] insertOutputFiles skipped — audit row already terminal; rolling back ${uploadedStorageIds.size} blob(s)`,
      );
      await rollbackUploadedBlobs(ctx, uploadedStorageIds);
      const cancelDurationMs = Date.now() - startedAt;
      return {
        executionId,
        success: false,
        status: 'cancelled',
        exitCode: spawnerResult.exitCode,
        errorCode: 'CANCELLED',
        errorMessage:
          'Run was cancelled while harvesting outputs; uploaded blobs rolled back.',
        stdoutPreview: '',
        stderrPreview: '',
        durationMs: cancelDurationMs,
        truncated: { stdout: false, stderr: false, files: 0 },
        files: [],
      };
    }

    // Upsert each harvested output into the thread workspace so the
    // canvas + future `file_read` see it. New files go under their name;
    // since the spawner's harvest names are POSIX paths relative to
    // /user/output/, we treat them as workspace paths verbatim.
    const upserted: Array<{
      path: string;
      storageId: Id<'_storage'>;
      size: number;
      contentType: string;
    }> = [];
    for (const f of insertResult.insertedFiles) {
      try {
        await ctx.runMutation(
          internal.thread_files.internal_mutations.upsertThreadFile,
          {
            organizationId: args.organizationId,
            threadId: args.threadId,
            path: f.name,
            storageId: f.storageId,
            size: f.size,
            contentType: f.contentType,
            source: 'run_output' as const,
          },
        );
        // Once upserted into threadFiles, the storage row is owned by
        // that table — clear it from the rollback set so a downstream
        // throw doesn't double-free.
        uploadedStorageIds.delete(String(f.storageId));
        upserted.push({
          path: f.name,
          storageId: f.storageId,
          size: f.size,
          contentType: f.contentType,
        });
      } catch (err) {
        console.warn(
          `[sandbox.executeCode] upsertThreadFile(${f.name}) failed:`,
          err,
        );
      }
    }

    const stdoutText = Buffer.from(
      spawnerResult.stdoutBase64,
      'base64',
    ).toString('utf8');
    const stderrText = Buffer.from(
      spawnerResult.stderrBase64,
      'base64',
    ).toString('utf8');
    const stdoutPreview = stdoutText.slice(0, SANDBOX_STDOUT_PREVIEW_MAX);
    const stderrPreview = stderrText.slice(0, SANDBOX_STDERR_PREVIEW_MAX);
    const durationMs = Date.now() - startedAt;

    try {
      await ctx.runMutation(internal.sandbox.internal_mutations.finalize, {
        executionId,
        status: spawnerResult.status,
        ...(spawnerResult.errorCode !== undefined && {
          errorCode: spawnerResult.errorCode,
        }),
        ...(spawnerResult.errorMessage !== undefined && {
          errorMessage: spawnerResult.errorMessage,
        }),
        stdoutPreview,
        stderrPreview,
        ...(spawnerResult.exitCode !== null && {
          exitCode: spawnerResult.exitCode,
        }),
        outputFiles: insertResult.insertedFiles.map((f) => ({
          name: f.name,
          fileMetadataId: f.fileMetadataId,
          storageId: f.storageId,
          size: f.size,
          contentType: f.contentType,
        })),
        durationMs,
        actualSeconds: durationMs / 1000,
      });
    } catch (err) {
      console.warn('[sandbox.executeCode] finalize failed:', err);
    }

    return {
      executionId,
      success: spawnerResult.status === 'completed',
      status: spawnerResult.status,
      exitCode: spawnerResult.exitCode,
      ...(spawnerResult.errorCode !== undefined && {
        errorCode: spawnerResult.errorCode,
      }),
      ...(spawnerResult.errorMessage !== undefined && {
        errorMessage: spawnerResult.errorMessage,
      }),
      stdoutPreview,
      stderrPreview,
      durationMs,
      truncated: spawnerResult.truncated,
      files: upserted,
      ...(spawnerResult.steps !== undefined && { steps: spawnerResult.steps }),
    };
  },
});

/**
 * Cancel every non-terminal sandbox execution attached to a thread. Wired
 * by `convex/threads/cancel_generation.ts` after the user clicks Stop on
 * the chat. For each row we POST /v1/cancel/:id (best-effort) and call
 * `cancelExecutionRecord` to mark the audit row cancelled.
 */
export const cancelExecutionsForThread = internalAction({
  args: { threadId: v.string() },
  returns: v.number(),
  handler: async (ctx: ActionCtx, args) => {
    const rows = await ctx.runQuery(
      internal.sandbox.internal_mutations.listNonTerminalByThread,
      { threadId: args.threadId },
    );
    let cancelled = 0;
    for (const row of rows) {
      try {
        // Route to the colour this execution started on so the cancel lands
        // even after a deploy flip moved the bare `sandbox` alias.
        await spawnerCancel(String(row._id), row.spawnerColor);
      } catch (err) {
        console.warn(
          `[sandbox.cancelExecutionsForThread] spawnerCancel(${row._id}) failed (continuing):`,
          err,
        );
      }
      try {
        await ctx.runMutation(
          internal.sandbox.internal_mutations.cancelExecutionRecord,
          { executionId: row._id, reason: 'Execution cancelled by user' },
        );
        cancelled += 1;
      } catch (err) {
        console.warn(
          `[sandbox.cancelExecutionsForThread] cancelExecutionRecord(${row._id}) failed:`,
          err,
        );
      }
    }
    return cancelled;
  },
});

/**
 * Cancel every RUNNING session exec attached to a thread (the external-agent
 * Stop path). The external-agent turn writes `sandboxSessionOps`, NOT the
 * one-shot `sandboxExecutions` table that `cancelExecutionsForThread` scans —
 * so without this, clicking Stop never reaches the in-sandbox agent process
 * (it only died as a side effect of the caller disconnecting). For each running
 * op we POST the session exec-cancel (SIGTERM→SIGKILL the process group); the
 * run's own finalize then persists the partial timeline + marks it failed.
 */
export const cancelSessionExecsForThread = internalAction({
  args: { threadId: v.string() },
  returns: v.number(),
  handler: async (ctx: ActionCtx, args) => {
    const ops = await ctx.runQuery(
      internal.sandbox.session_queries.listRunningOpsByThread,
      { threadId: args.threadId },
    );
    let cancelled = 0;
    const cancelledSessions = new Set<string>();
    for (const op of ops) {
      try {
        await sessionCancelExec(op.sessionId, op.execId);
        cancelled += 1;
        cancelledSessions.add(op.sessionId);
      } catch (err) {
        console.warn(
          `[sandbox.cancelSessionExecsForThread] sessionCancelExec(${op.sessionId}/${op.execId}) failed (continuing):`,
          err,
        );
      }
    }
    // On a browser-view deployment, reset the stopped turn's tabs so a
    // runaway/hung page can't wedge the next turn's CDP attach. Tabs only —
    // cookies/logins are preserved (close-pages, not reset). Best-effort: a
    // no-managed-browser session no-ops spawner-side, and any failure is logged
    // (the Stop itself already succeeded above).
    if (process.env.SANDBOX_BROWSER_VIEW === '1') {
      for (const sessionId of cancelledSessions) {
        try {
          const closed = await sessionBrowserClosePages(sessionId);
          if (closed > 0) {
            console.info(
              `[sandbox.cancelSessionExecsForThread] closed ${closed} browser tab(s) for ${sessionId} on stop`,
            );
          }
        } catch (err) {
          console.warn(
            `[sandbox.cancelSessionExecsForThread] browser close-pages(${sessionId}) failed (continuing):`,
            err,
          );
        }
      }
    }
    return cancelled;
  },
});
