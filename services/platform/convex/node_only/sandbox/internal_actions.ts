'use node';

// `executeCode` — the action the `artifact_run` agent tool calls.
//
// Owns the spawner round-trip + storage transactionality:
//   1. reserveSlotAndInsert mutation (atomic quota + audit row insert).
//   2. setRunning('installing') mutation + start a 60s heartbeat loop.
//   3. POST /v1/execute on the spawner with AbortSignal wired through.
//   4. Upload every output blob; if all succeed, single batched
//      `insertOutputFiles` mutation. On any storage failure, delete the
//      blobs we already wrote so we don't orphan `_storage`.
//   5. Upload stdout/stderr to `_storage` when over the preview cap.
//   6. finalize mutation with the structured result.
//
// Every failure path goes through the same `failExecution` helper which
// finalizes the audit row, finalizes the artifact row if one was tied to
// this run, and rolls back any uploaded storage blobs. This makes the
// "canvas spinner stuck forever" failure mode (R1 finding) structurally
// impossible — there is one terminate-and-clean code path, not six.
//
// Error rule:
//   - Infrastructure failures (spawner unreachable, action timeout, quota
//     mutation throw) → finalize + THROW so the agent SDK surfaces them.
//   - User-code failures (exit ≠ 0, sandbox timeout, OOM, install failure)
//     → finalize + RETURN structured result so the LLM can read and react.

import { ConvexError, v } from 'convex/values';

import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import { internalAction, type ActionCtx } from '../../_generated/server';
import {
  SANDBOX_CODE_PREVIEW_MAX,
  SANDBOX_DEFAULT_TIMEOUT_MS,
  SANDBOX_MAX_TIMEOUT_MS,
  SANDBOX_STDERR_PREVIEW_MAX,
  SANDBOX_STDOUT_PREVIEW_MAX,
} from '../../sandbox/schema';
import {
  sandboxErrorCodeValidator,
  sandboxLanguageValidator,
  type SandboxErrorCode,
  type SandboxRunProgressKind,
} from '../../sandbox/wire';
import { spawnerCancel, spawnerExecute } from './helpers/spawner_client';

const HEARTBEAT_INTERVAL_MS = 60_000;

// Explicit handler return type. Required to break a self-referential type
// cycle: without it, the inferred type of `executeCode` depends on its own
// handler's return type (which reaches `internal.sandbox.*` through
// `_generated/api.d.ts`). The cycle collapses every Convex consumer in the
// codebase to `any` — see PR #1727 CI breakage.
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
    name: string;
    fileMetadataId: Id<'fileMetadata'>;
    storageId: Id<'_storage'>;
    size: number;
    contentType: string;
  }>;
};

interface FailContext {
  ctx: ActionCtx;
  executionId: Id<'sandboxExecutions'>;
  artifactId?: Id<'artifacts'>;
  uploadedStorageIds: Set<string>;
  startedAt: number;
}

/**
 * One-stop failure handler. Finalizes the audit row, finalizes the artifact
 * row (so the canvas spinner stops), and cascade-deletes any `_storage`
 * blobs we already wrote. Always returns the structured result the caller
 * can `return` directly.
 */
async function failExecution(
  fc: FailContext,
  status: 'failed' | 'cancelled',
  errorCode: SandboxErrorCode,
  errorMessage: string,
  extra?: {
    stdoutPreview?: string;
    stderrPreview?: string;
    exitCode?: number | null;
  },
): Promise<ExecuteCodeResult> {
  const durationMs = Date.now() - fc.startedAt;
  // Roll back any _storage blobs we already wrote so we don't orphan them.
  for (const sid of fc.uploadedStorageIds) {
    try {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- delete needs Id<'_storage'>
      await fc.ctx.storage.delete(sid as unknown as Id<'_storage'>);
    } catch (err) {
      console.warn(
        `[sandbox.failExecution] storage.delete(${sid}) failed:`,
        err,
      );
    }
  }
  fc.uploadedStorageIds.clear();

  try {
    await fc.ctx.runMutation(internal.sandbox.internal_mutations.finalize, {
      executionId: fc.executionId,
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

  if (fc.artifactId) {
    try {
      await fc.ctx.runMutation(
        internal.artifacts.internal_mutations.finalizeArtifactRun,
        {
          artifactId: fc.artifactId,
          runStatus: status,
          runErrorCode: errorCode,
          runErrorMessage: errorMessage,
          ...(extra?.exitCode !== undefined &&
            extra.exitCode !== null && { runExitCode: extra.exitCode }),
          ...(extra?.stdoutPreview !== undefined && {
            runStdoutPreview: extra.stdoutPreview,
          }),
          ...(extra?.stderrPreview !== undefined && {
            runStderrPreview: extra.stderrPreview,
          }),
          runOutputFiles: [],
          runExecutionId: fc.executionId,
        },
      );
    } catch (err) {
      console.warn(`[sandbox.failExecution] artifact finalize failed:`, err);
    }
  }

  return {
    executionId: fc.executionId,
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

function buildInstallProgress(packages: string[] | undefined): {
  kind: SandboxRunProgressKind;
  package?: string;
  version?: string;
} {
  if (!packages || packages.length === 0) {
    return { kind: 'installing' };
  }
  // `python-pptx==1.0.2` → { package: 'python-pptx', version: '1.0.2' }.
  // Anything that doesn't match the canonical pip/npm spec falls back to
  // the no-version variant; the UI message map handles both via ICU.
  const first = packages[0];
  if (first === undefined) return { kind: 'installing' };
  const match = first.match(/^([^@=<>!~]+)(?:[@=]=?([^@=<>!~ ]+))?/);
  if (match && match[1]) {
    return {
      kind: 'installingPackage',
      package: match[1].trim(),
      ...(match[2] !== undefined && { version: match[2].trim() }),
    };
  }
  return { kind: 'installing' };
}

export const executeCode = internalAction({
  args: {
    organizationId: v.string(),
    uploadedBy: v.string(),
    threadId: v.optional(v.string()),
    messageId: v.optional(v.string()),
    toolCallId: v.optional(v.string()),
    agentSlug: v.optional(v.string()),

    language: sandboxLanguageValidator,
    code: v.string(),
    packages: v.optional(v.array(v.string())),
    timeoutMs: v.optional(v.number()),
    // NOTE: `allowSdist` / `allowInstallScripts` are intentionally NOT
    // accepted as action args. The spawner-side install guards (`pip
    // --only-binary=:all:` and `npm --ignore-scripts`) are hardcoded
    // server-side here so a prompt-injected LLM cannot disable them
    // (round-2 R2-B4). To grant a per-org carve-out, add an
    // `orgs.sandboxPolicy` table and gate the override there instead of
    // surfacing the knob to the LLM.
    purpose: v.string(),
    // When set, the action wires PHASE events from the spawner SSE to
    // patchArtifactRunProgress and finalizeArtifactRun — canvas shows
    // live progress instead of a frozen spinner.
    artifactId: v.optional(v.id('artifacts')),
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
        name: v.string(),
        fileMetadataId: v.id('fileMetadata'),
        storageId: v.id('_storage'),
        size: v.number(),
        contentType: v.string(),
      }),
    ),
  }),
  handler: async (ctx, args): Promise<ExecuteCodeResult> => {
    const timeoutMs = Math.min(
      Math.max(args.timeoutMs ?? SANDBOX_DEFAULT_TIMEOUT_MS, 1_000),
      SANDBOX_MAX_TIMEOUT_MS,
    );
    const estimatedSeconds = Math.ceil(timeoutMs / 1000);

    // ---- codePreview / codeStorageId split ----
    const codeBytes = Buffer.byteLength(args.code, 'utf8');
    let codePreview = args.code;
    let codeStorageId: Id<'_storage'> | undefined;
    if (codeBytes > SANDBOX_CODE_PREVIEW_MAX) {
      const blob = new Blob([args.code], { type: 'text/plain' });
      codeStorageId = await ctx.storage.store(blob);
      codePreview = args.code.slice(0, SANDBOX_CODE_PREVIEW_MAX);
    }

    // ---- atomic reservation (concurrent cap + daily CPU budget + insert) ----
    // If reservation throws (QUOTA_EXCEEDED, daily budget, etc.) the blob we
    // just stored is orphaned — it never lands on an audit row to be owned.
    // The wider `failExecution`-driven rollback set isn't yet constructed at
    // this point, so we delete here in the catch (audit finding R2-B7 #1).
    let executionId: Id<'sandboxExecutions'>;
    try {
      executionId = await ctx.runMutation(
        internal.sandbox.internal_mutations.reserveSlotAndInsert,
        {
          organizationId: args.organizationId,
          uploadedBy: args.uploadedBy,
          ...(args.threadId !== undefined && { threadId: args.threadId }),
          ...(args.messageId !== undefined && { messageId: args.messageId }),
          ...(args.toolCallId !== undefined && {
            toolCallId: args.toolCallId,
          }),
          ...(args.agentSlug !== undefined && { agentSlug: args.agentSlug }),
          ...(args.artifactId !== undefined && { artifactId: args.artifactId }),
          language: args.language,
          purpose: args.purpose,
          codePreview,
          ...(codeStorageId !== undefined && { codeStorageId }),
          packages: args.packages ?? [],
          // installOptions is intentionally NOT forwarded: install-safety
          // is hardcoded server-side (round-2 R2-B4). The schema field
          // remains optional for backward compatibility with old rows.
          estimatedSeconds,
        },
      );
    } catch (err) {
      // Reservation failed — the codeStorageId blob is now orphaned. Delete
      // it before propagating so a quota-bounce-loop doesn't accrete
      // unowned `_storage` rows (audit finding R2-B7 #1).
      if (codeStorageId !== undefined) {
        try {
          await ctx.storage.delete(codeStorageId);
        } catch (deleteErr) {
          console.warn(
            '[sandbox.executeCode] codeStorageId rollback after reservation failure failed:',
            deleteErr,
          );
        }
      }
      // Quota errors are user-facing — surface as ConvexError. The tool's
      // wrapper translates this into structured agent-visible output.
      if (
        err instanceof ConvexError &&
        typeof err.data === 'object' &&
        err.data !== null &&
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ConvexError data shape is loose
        (err.data as { code?: string }).code === 'QUOTA_EXCEEDED'
      ) {
        const dataMessage =
          err.data && typeof err.data === 'object' && 'message' in err.data
            ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ConvexError data shape is loose; we just type-narrowed the message key
              String((err.data as { message?: string }).message)
            : 'Sandbox quota exceeded';
        throw new ConvexError({
          code: 'QUOTA_EXCEEDED',
          message: dataMessage,
        });
      }
      throw err;
    }

    const startedAt = Date.now();
    const uploadedStorageIds = new Set<string>();
    const fc: FailContext = {
      ctx,
      executionId,
      ...(args.artifactId !== undefined && { artifactId: args.artifactId }),
      uploadedStorageIds,
      startedAt,
    };

    // ---- flip status to installing, start heartbeat ----
    // The spawner emits a real `installing` phase event later, but flipping
    // to `installing` here means the watchdog can also reap rows that get
    // stuck before the spawner ever responds (the `queued` sweep handles
    // throws between this point and reserveSlotAndInsert, but `installing`
    // also signals the canvas to show a progress spinner immediately).
    try {
      await ctx.runMutation(internal.sandbox.internal_mutations.setRunning, {
        executionId,
        status: 'installing',
      });
    } catch (err) {
      return failExecution(
        fc,
        'failed',
        'SPAWNER_UNAVAILABLE',
        `failed to flip audit row to installing: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Fire heartbeat from a separate function so we can also call it inline
    // around long blocking work (storage uploads of multi-MB output files
    // can otherwise hog the event loop long enough that the interval timer's
    // fires get coalesced and `heartbeatAt` ages past the watchdog cutoff,
    // causing the watchdog to wrongly mark this live run as stuck —
    // audit finding R2-B6 #3).
    const tickHeartbeat = async (): Promise<void> => {
      try {
        await ctx.runMutation(internal.sandbox.internal_mutations.heartbeat, {
          executionId,
        });
      } catch (err) {
        // Don't swallow silently — a stalled heartbeat path is exactly the
        // failure mode the watchdog mis-classifies as "stuck execution"
        // (R2-B6 #2). Logging it makes the regression visible in production
        // before users notice the wrong-side ghost result.
        console.warn('[sandbox.executeCode] heartbeat mutation failed:', err);
      }
    };
    const heartbeat = setInterval(() => {
      void tickHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);

    const abort = new AbortController();

    try {
      const spawnerResult = await spawnerExecute(
        {
          executionId: String(executionId),
          organizationId: args.organizationId,
          language: args.language,
          code: args.code,
          ...(args.packages !== undefined && { packages: args.packages }),
          timeoutMs,
          // Hardcoded sandbox-safety: pip --only-binary=:all: + npm
          // --ignore-scripts are ALWAYS in force. The LLM cannot disable
          // them via tool input (round-2 R2-B4).
          options: { allowSdist: false, allowInstallScripts: false },
        },
        abort.signal,
        {
          onPhase: args.artifactId
            ? async (phase) => {
                // Structured progress — UI renders the localized text via
                // the `chat.runnable.progress.*` i18n keys. We never write
                // English literals into the artifact row anymore.
                const runProgress =
                  phase === 'installing'
                    ? buildInstallProgress(args.packages)
                    : phase === 'running'
                      ? { kind: 'running' as const }
                      : phase === 'preparing'
                        ? { kind: 'preparing' as const }
                        : undefined;
                const runStatus =
                  phase === 'installing'
                    ? 'installing'
                    : phase === 'running'
                      ? 'running'
                      : phase === 'preparing'
                        ? 'installing'
                        : undefined;
                if (!runStatus) return;
                await ctx.runMutation(
                  internal.artifacts.internal_mutations
                    .patchArtifactRunProgress,
                  {
                    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by args.artifactId guard
                    artifactId: args.artifactId as NonNullable<
                      typeof args.artifactId
                    >,
                    runStatus,
                    ...(runProgress && { runProgress }),
                    runExecutionId: executionId,
                  },
                );
              }
            : undefined,
        },
      );

      // ---- file upload (all-or-nothing) ----
      // Each ctx.storage.store can take seconds for multi-MB blobs; an
      // explicit heartbeat between uploads keeps `heartbeatAt` fresh so the
      // watchdog doesn't reap this row mid-upload (audit finding R2-B6 #3).
      const stagedForInsert: Array<{
        name: string;
        storageId: Id<'_storage'>;
        size: number;
        contentType: string;
      }> = [];
      for (const f of spawnerResult.outputFiles) {
        await tickHeartbeat();
        try {
          const bytes = Buffer.from(f.contentBase64, 'base64');
          const blob = new Blob([bytes], { type: f.contentType });
          const storageId = await ctx.storage.store(blob);
          uploadedStorageIds.add(String(storageId));
          stagedForInsert.push({
            name: f.name,
            storageId,
            size: f.size,
            contentType: f.contentType,
          });
        } catch (err) {
          return failExecution(
            fc,
            'failed',
            'SPAWNER_UNAVAILABLE',
            `Output upload failed: ${err instanceof Error ? err.message : String(err)}`,
            {
              stdoutPreview: spawnerResult.stdoutBase64
                ? Buffer.from(spawnerResult.stdoutBase64, 'base64')
                    .toString('utf8')
                    .slice(0, SANDBOX_STDOUT_PREVIEW_MAX)
                : '',
              stderrPreview: spawnerResult.stderrBase64
                ? Buffer.from(spawnerResult.stderrBase64, 'base64')
                    .toString('utf8')
                    .slice(0, SANDBOX_STDERR_PREVIEW_MAX)
                : '',
            },
          );
        }
      }

      const insertedFiles = await ctx.runMutation(
        internal.sandbox.output_mutations.insertOutputFiles,
        {
          organizationId: args.organizationId,
          ...(args.threadId !== undefined && { threadId: args.threadId }),
          uploadedBy: args.uploadedBy,
          files: stagedForInsert,
        },
      );

      // ---- stdout/stderr previews + overflow storage ----
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
      let stdoutStorageId: Id<'_storage'> | undefined;
      let stderrStorageId: Id<'_storage'> | undefined;
      if (stdoutText.length > SANDBOX_STDOUT_PREVIEW_MAX) {
        await tickHeartbeat();
        const blob = new Blob([stdoutText], { type: 'text/plain' });
        stdoutStorageId = await ctx.storage.store(blob);
        uploadedStorageIds.add(String(stdoutStorageId));
      }
      if (stderrText.length > SANDBOX_STDERR_PREVIEW_MAX) {
        await tickHeartbeat();
        const blob = new Blob([stderrText], { type: 'text/plain' });
        stderrStorageId = await ctx.storage.store(blob);
        uploadedStorageIds.add(String(stderrStorageId));
      }

      const durationMs = spawnerResult.durationMs;
      const actualSeconds = durationMs / 1000;

      await ctx.runMutation(internal.sandbox.internal_mutations.finalize, {
        executionId,
        status: spawnerResult.status,
        ...(spawnerResult.exitCode !== null && {
          exitCode: spawnerResult.exitCode,
        }),
        ...(spawnerResult.errorCode !== undefined && {
          errorCode: spawnerResult.errorCode,
        }),
        ...(spawnerResult.errorMessage !== undefined && {
          errorMessage: spawnerResult.errorMessage,
        }),
        stdoutPreview,
        stderrPreview,
        ...(stdoutStorageId !== undefined && { stdoutStorageId }),
        ...(stderrStorageId !== undefined && { stderrStorageId }),
        outputFiles: insertedFiles.map((f) => ({
          name: f.name,
          fileMetadataId: f.fileMetadataId,
          size: f.size,
          contentType: f.contentType,
        })),
        truncated: spawnerResult.truncated,
        durationMs,
        actualSeconds,
      });

      // When this run is tied to a runnable artifact, finalize the artifact
      // row so the canvas-runnable-code-renderer sees the completed state
      // + output file chips. The audit row above already holds the
      // per-execution forensics; the artifact row holds the *latest* state
      // for fast canvas reads.
      if (args.artifactId) {
        await ctx.runMutation(
          internal.artifacts.internal_mutations.finalizeArtifactRun,
          {
            artifactId: args.artifactId,
            runStatus: spawnerResult.status,
            ...(spawnerResult.exitCode !== null && {
              runExitCode: spawnerResult.exitCode,
            }),
            ...(spawnerResult.errorCode !== undefined && {
              runErrorCode: spawnerResult.errorCode,
            }),
            ...(spawnerResult.errorMessage !== undefined && {
              runErrorMessage: spawnerResult.errorMessage,
            }),
            runStdoutPreview: stdoutPreview,
            runStderrPreview: stderrPreview,
            ...(stdoutStorageId !== undefined && {
              runStdoutStorageId: stdoutStorageId,
            }),
            ...(stderrStorageId !== undefined && {
              runStderrStorageId: stderrStorageId,
            }),
            runOutputFiles: insertedFiles.map((f) => ({
              name: f.name,
              fileMetadataId: f.fileMetadataId,
              storageId: f.storageId,
              size: f.size,
              contentType: f.contentType,
            })),
            runExecutionId: executionId,
          },
        );
      }

      // Successful path — the storage IDs are now owned by mutations; drop
      // them from the rollback set so the finally block doesn't double-free.
      uploadedStorageIds.clear();

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
        files: insertedFiles,
      };
    } catch (err) {
      // Infra failure: best-effort spawner cancel (idempotent if container
      // already gone) and route through failExecution so the audit + artifact
      // rows both terminate AND any uploaded blobs are reclaimed.
      const message = err instanceof Error ? err.message : String(err);
      try {
        await spawnerCancel(String(executionId));
      } catch (cancelErr) {
        console.warn(
          `[sandbox.executeCode] best-effort spawnerCancel failed:`,
          cancelErr,
        );
      }
      await failExecution(fc, 'failed', 'SPAWNER_UNAVAILABLE', message);
      throw new Error(`Sandbox spawner failed: ${message}`, { cause: err });
    } finally {
      clearInterval(heartbeat);
      // Abort any in-flight fetch from spawnerExecute so the spawner-side
      // request can tear down promptly when the action exits (success,
      // structured failure, OR thrown infra error).
      abort.abort('action-exit');
    }
  },
});
