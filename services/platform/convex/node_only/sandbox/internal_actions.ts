'use node';

// `executeCode` — the action the `code_run` agent tool calls.
//
// Owns the spawner round-trip + storage transactionality:
//   1. reserveSlotAndInsert mutation (atomic quota + audit row insert).
//   2. resolveInputFiles internal query (IDOR + org/thread scoping).
//   3. ctx.storage.get → base64 for each input file.
//   4. setRunning mutation + start a 60s heartbeat loop.
//   5. POST /v1/execute on the spawner with AbortSignal wired through.
//   6. Upload every output blob; if all succeed, single batched
//      `insertOutputFiles` mutation. On any storage failure, delete the
//      blobs we already wrote so we don't orphan `_storage`.
//   7. Upload stdout/stderr to `_storage` when over the preview cap.
//   8. finalize mutation with the structured result.
//   9. usageLedger row (TODO: wire in once schema accepts cpuSeconds —
//      see plan §4 step 9; ledger schema extension is a separate PR).
//
// Error rule (per R1.13 / [feedback_no_empty_catch]):
//   - Infrastructure failures (spawner unreachable, action timeout, quota
//     mutation throw) → THROW so the agent SDK surfaces them clearly.
//   - User-code failures (exit ≠ 0, sandbox timeout, OOM, install failure)
//     → RETURN structured `{success: false, status: 'failed', errorCode, ...}`
//     so the LLM can read and react.

import { ConvexError, v } from 'convex/values';

import { internal } from '../../_generated/api';
import { internalAction } from '../../_generated/server';
import {
  SANDBOX_CODE_PREVIEW_MAX,
  SANDBOX_DEFAULT_TIMEOUT_MS,
  SANDBOX_MAX_TIMEOUT_MS,
  SANDBOX_STDERR_PREVIEW_MAX,
  SANDBOX_STDOUT_PREVIEW_MAX,
} from '../../sandbox/schema';
import { spawnerCancel, spawnerExecute } from './helpers/spawner_client';

const languageValidator = v.union(v.literal('python'), v.literal('node'));

const errorCodeValidator = v.union(
  v.literal('TIMEOUT'),
  v.literal('OOM'),
  v.literal('EGRESS_DENIED'),
  v.literal('INSTALL_FAILED'),
  v.literal('PACKAGE_NOT_FOUND'),
  v.literal('QUOTA_EXCEEDED'),
  v.literal('RUNTIME_ERROR'),
  v.literal('SPAWNER_UNAVAILABLE'),
  v.literal('CANCELLED'),
);

const HEARTBEAT_INTERVAL_MS = 60_000;

export const executeCode = internalAction({
  args: {
    organizationId: v.string(),
    uploadedBy: v.string(),
    threadId: v.optional(v.string()),
    accessibleThreadIds: v.array(v.string()),
    messageId: v.optional(v.string()),
    toolCallId: v.optional(v.string()),
    agentSlug: v.optional(v.string()),

    language: languageValidator,
    code: v.string(),
    packages: v.optional(v.array(v.string())),
    inputFiles: v.optional(
      v.array(v.object({ name: v.string(), fileId: v.string() })),
    ),
    timeoutMs: v.optional(v.number()),
    allowSdist: v.optional(v.boolean()),
    allowInstallScripts: v.optional(v.boolean()),
    purpose: v.string(),
    // When set, the action wires PHASE events from the spawner SSE to
    // patchArtifactRunProgress and finalizeArtifactRun (Refinement 2 —
    // canvas shows live progress instead of a frozen spinner).
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
    errorCode: v.optional(errorCodeValidator),
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
  handler: async (ctx, args) => {
    const timeoutMs = Math.min(
      Math.max(args.timeoutMs ?? SANDBOX_DEFAULT_TIMEOUT_MS, 1_000),
      SANDBOX_MAX_TIMEOUT_MS,
    );
    const estimatedSeconds = Math.ceil(timeoutMs / 1000);

    // ---- codePreview / codeStorageId split ----
    const codeBytes = Buffer.byteLength(args.code, 'utf8');
    let codePreview = args.code;
    let codeStorageId: string | undefined;
    if (codeBytes > SANDBOX_CODE_PREVIEW_MAX) {
      const blob = new Blob([args.code], { type: 'text/plain' });
      codeStorageId = await ctx.storage.store(blob);
      codePreview = args.code.slice(0, SANDBOX_CODE_PREVIEW_MAX);
    }

    // ---- atomic reservation (concurrent cap + daily CPU budget + insert) ----
    let executionId: Awaited<
      ReturnType<
        typeof ctx.runMutation<
          typeof internal.sandbox.internal_mutations.reserveSlotAndInsert
        >
      >
    >;
    try {
      executionId = await ctx.runMutation(
        internal.sandbox.internal_mutations.reserveSlotAndInsert,
        {
          organizationId: args.organizationId,
          uploadedBy: args.uploadedBy,
          ...(args.threadId !== undefined && { threadId: args.threadId }),
          ...(args.messageId !== undefined && { messageId: args.messageId }),
          ...(args.toolCallId !== undefined && { toolCallId: args.toolCallId }),
          ...(args.agentSlug !== undefined && { agentSlug: args.agentSlug }),
          language: args.language,
          purpose: args.purpose,
          codePreview,
          ...(codeStorageId !== undefined && {
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- storage.store returns Id<'_storage'>
            codeStorageId: codeStorageId as unknown as never,
          }),
          packages: args.packages ?? [],
          ...((args.allowSdist !== undefined ||
            args.allowInstallScripts !== undefined) && {
            installOptions: {
              ...(args.allowSdist !== undefined && {
                allowSdist: args.allowSdist,
              }),
              ...(args.allowInstallScripts !== undefined && {
                allowInstallScripts: args.allowInstallScripts,
              }),
            },
          }),
          estimatedSeconds,
        },
      );
    } catch (err) {
      // Quota errors are user-facing — surface as structured result rather
      // than throwing, so the LLM can decide to wait / retry / abort.
      if (
        err instanceof ConvexError &&
        typeof err.data === 'object' &&
        err.data !== null &&
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ConvexError data shape is loose
        (err.data as { code?: string }).code === 'QUOTA_EXCEEDED'
      ) {
        // We never got an executionId, so synthesize a clearly-unreal one.
        // The tool's wrapper will surface this back to the LLM cleanly.
        throw new ConvexError({
          code: 'QUOTA_EXCEEDED',
          message:
            err.data && typeof err.data === 'object' && 'message' in err.data
              ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ConvexError data shape is loose; we just type-narrowed the message key
                String((err.data as { message?: string }).message)
              : 'Sandbox quota exceeded',
        });
      }
      throw err;
    }

    // ---- input file resolution + IDOR check ----
    let stagedInputs: { name: string; contentBase64: string }[] = [];
    if (args.inputFiles && args.inputFiles.length > 0) {
      const resolved = await ctx.runQuery(
        internal.sandbox.internal_queries.resolveInputFiles,
        {
          organizationId: args.organizationId,
          accessibleThreadIds: args.accessibleThreadIds,
          fileIds: args.inputFiles.map((f) => f.fileId),
        },
      );
      if (!resolved.ok) {
        await ctx.runMutation(internal.sandbox.internal_mutations.finalize, {
          executionId,
          status: 'failed',
          errorCode: 'SPAWNER_UNAVAILABLE',
          errorMessage: `Input file rejected: ${resolved.reason}`,
          outputFiles: [],
          durationMs: 0,
          actualSeconds: 0,
        });
        return {
          executionId,
          success: false,
          status: 'failed' as const,
          exitCode: null,
          errorCode: 'SPAWNER_UNAVAILABLE' as const,
          errorMessage: `Input file rejected: ${resolved.reason}`,
          stdoutPreview: '',
          stderrPreview: '',
          durationMs: 0,
          truncated: { stdout: false, stderr: false, files: 0 },
          files: [],
        };
      }
      stagedInputs = await Promise.all(
        resolved.files.map(async (rf, i) => {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- storage id from resolveInputFiles is the branded type
          const blob = await ctx.storage.get(rf.storageId as never);
          if (!blob) {
            throw new Error(
              `Sandbox: failed to read storage blob for ${rf.fileName}`,
            );
          }
          const ab = await blob.arrayBuffer();
          const requested = args.inputFiles?.[i];
          return {
            name: requested?.name ?? rf.fileName,
            contentBase64: Buffer.from(ab).toString('base64'),
          };
        }),
      );
    }

    // ---- flip status, start heartbeat ----
    await ctx.runMutation(internal.sandbox.internal_mutations.setRunning, {
      executionId,
    });

    const heartbeat = setInterval(() => {
      void ctx.runMutation(internal.sandbox.internal_mutations.heartbeat, {
        executionId,
      });
    }, HEARTBEAT_INTERVAL_MS);

    const abort = new AbortController();
    const startedAt = Date.now();

    try {
      const spawnerResult = await spawnerExecute(
        {
          executionId: String(executionId),
          organizationId: args.organizationId,
          language: args.language,
          code: args.code,
          ...(args.packages !== undefined && { packages: args.packages }),
          ...(stagedInputs.length > 0 && { inputFiles: stagedInputs }),
          timeoutMs,
          ...((args.allowSdist !== undefined ||
            args.allowInstallScripts !== undefined) && {
            options: {
              ...(args.allowSdist !== undefined && {
                allowSdist: args.allowSdist,
              }),
              ...(args.allowInstallScripts !== undefined && {
                allowInstallScripts: args.allowInstallScripts,
              }),
            },
          }),
        },
        abort.signal,
        {
          onPhase: args.artifactId
            ? async (phase) => {
                const message =
                  phase === 'installing'
                    ? args.packages && args.packages.length > 0
                      ? `Installing ${args.packages.join(', ')}`
                      : 'Preparing sandbox'
                    : 'Running code';
                await ctx.runMutation(
                  internal.artifacts.internal_mutations
                    .patchArtifactRunProgress,
                  {
                    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by args.artifactId guard
                    artifactId: args.artifactId as NonNullable<
                      typeof args.artifactId
                    >,
                    runStatus: phase,
                    runProgress: message,
                    runExecutionId: executionId,
                  },
                );
              }
            : undefined,
        },
      );

      // ---- file upload (all-or-nothing) ----
      const uploadedStorageIds: string[] = [];
      let uploadFailureMessage: string | undefined;
      const stagedForInsert: {
        name: string;
        // oxlint-disable-next-line typescript/no-explicit-any -- normalized as Id<'_storage'> in mutation arg validator
        storageId: any;
        size: number;
        contentType: string;
      }[] = [];
      for (const f of spawnerResult.outputFiles) {
        try {
          const bytes = Buffer.from(f.contentBase64, 'base64');
          const blob = new Blob([bytes], { type: f.contentType });
          const storageId = await ctx.storage.store(blob);
          uploadedStorageIds.push(String(storageId));
          stagedForInsert.push({
            name: f.name,
            storageId,
            size: f.size,
            contentType: f.contentType,
          });
        } catch (err) {
          uploadFailureMessage =
            err instanceof Error ? err.message : String(err);
          break;
        }
      }
      if (uploadFailureMessage !== undefined) {
        // Roll back uploads we already wrote so _storage doesn't orphan.
        for (const sid of uploadedStorageIds) {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- delete needs Id<'_storage'>
          await ctx.storage.delete(sid as never).catch(() => {});
        }
        await ctx.runMutation(internal.sandbox.internal_mutations.finalize, {
          executionId,
          status: 'failed',
          errorCode: 'SPAWNER_UNAVAILABLE',
          errorMessage: `Output upload failed: ${uploadFailureMessage}`,
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
          outputFiles: [],
          durationMs: Date.now() - startedAt,
          actualSeconds: (Date.now() - startedAt) / 1000,
        });
        return {
          executionId,
          success: false,
          status: 'failed' as const,
          exitCode: null,
          errorCode: 'SPAWNER_UNAVAILABLE' as const,
          errorMessage: `Output upload failed: ${uploadFailureMessage}`,
          stdoutPreview: '',
          stderrPreview: '',
          durationMs: Date.now() - startedAt,
          truncated: { stdout: false, stderr: false, files: 0 },
          files: [],
        };
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
      let stdoutStorageId: string | undefined;
      let stderrStorageId: string | undefined;
      if (stdoutText.length > SANDBOX_STDOUT_PREVIEW_MAX) {
        const blob = new Blob([stdoutText], { type: 'text/plain' });
        stdoutStorageId = await ctx.storage.store(blob);
      }
      if (stderrText.length > SANDBOX_STDERR_PREVIEW_MAX) {
        const blob = new Blob([stderrText], { type: 'text/plain' });
        stderrStorageId = await ctx.storage.store(blob);
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
        ...(stdoutStorageId !== undefined && {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- store returns Id<'_storage'>
          stdoutStorageId: stdoutStorageId as unknown as never,
        }),
        ...(stderrStorageId !== undefined && {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion
          stderrStorageId: stderrStorageId as unknown as never,
        }),
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
      // + output file chips (Refinement 2). The audit row above already
      // holds the per-execution forensics; the artifact row holds the
      // *latest* state for fast canvas reads.
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
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion
              runStdoutStorageId: stdoutStorageId as unknown as never,
            }),
            ...(stderrStorageId !== undefined && {
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion
              runStderrStorageId: stderrStorageId as unknown as never,
            }),
            runOutputFiles: insertedFiles.map((f) => ({
              name: f.name,
              fileMetadataId: f.fileMetadataId,
              size: f.size,
              contentType: f.contentType,
            })),
            runExecutionId: executionId,
          },
        );
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
        files: insertedFiles,
      };
    } catch (err) {
      // Infra failure: throw so the agent SDK surfaces it. We still finalize
      // the audit row to release the slot.
      const message = err instanceof Error ? err.message : String(err);
      // Best-effort spawner cancel (idempotent if container already gone).
      await spawnerCancel(String(executionId));
      await ctx.runMutation(internal.sandbox.internal_mutations.finalize, {
        executionId,
        status: 'failed',
        errorCode: 'SPAWNER_UNAVAILABLE',
        errorMessage: message,
        outputFiles: [],
        durationMs: Date.now() - startedAt,
        actualSeconds: (Date.now() - startedAt) / 1000,
      });
      throw new Error(`Sandbox spawner failed: ${message}`, { cause: err });
    } finally {
      clearInterval(heartbeat);
    }
  },
});
