/**
 * Convex Tool: artifact_edit
 *
 * Modifies an existing artifact via either a list of search/replace
 * patches (`mode: 'patch'`) or a complete rewrite (`mode: 'rewrite'`).
 * Patch mode is preferred — it's smaller to stream and easier to validate.
 *
 * Streaming: `mode: 'patch'` shows a status badge while the LLM emits the
 * patch list; the actual content updates atomically when `execute` runs
 * (so half-emitted patches never partially mutate the document). For
 * `mode: 'rewrite'`, the partial content is mirrored to `streamingContent`
 * with throttling so the user sees live typing in the Canvas pane.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import type { ToolExecutionOptions } from 'ai';
import { parsePartialJson } from 'ai';
import { z } from 'zod/v4';

import { getString, isRecord } from '../../../lib/utils/type-guards';
import { internal } from '../../_generated/api';
import { toId } from '../../lib/type_cast_helpers';
import type { ToolDefinition } from '../types';
import { isRunnableArtifactType, runnableLanguage } from './shared';
import {
  type StreamingPatchPair,
  clearState,
  getState,
  initState,
  markFlushedStreamingPatches,
  markParsed,
  scheduleStreamingFlush,
  shouldFlushStreamingPatches,
  shouldParse,
} from './stream_state';

const patchEntry = z.object({
  search: z
    .string()
    .min(1)
    .describe(
      'Snippet that appears verbatim in the artifact and matches exactly once. Include enough surrounding context to make the snippet unique.',
    ),
  replace: z
    .string()
    .describe(
      'Replacement text. Empty string deletes the search block entirely.',
    ),
});

const patchModeArgs = z.object({
  artifactId: z
    .string()
    .min(1)
    .describe(
      'Convex artifact ID returned by `artifact_create` (or referenced from the <artifacts> system context).',
    ),
  mode: z.literal('patch'),
  patches: z
    .array(patchEntry)
    .min(1)
    .max(20)
    .describe(
      'Ordered list of search/replace patches. Each patch operates on the result of the previous patch — so a later patch can match text introduced by an earlier one.',
    ),
});

const rewriteModeArgs = z.object({
  artifactId: z.string().min(1),
  mode: z.literal('rewrite'),
  content: z
    .string()
    .min(1)
    .describe(
      'Complete new artifact content. Use only when the change spans most of the file; otherwise prefer mode=`patch`.',
    ),
});

const artifactEditArgs = z.discriminatedUnion('mode', [
  patchModeArgs,
  rewriteModeArgs,
]);

type ArtifactEditInput = z.infer<typeof artifactEditArgs>;

interface ArtifactEditSuccess {
  success: true;
  artifactId: string;
  revision: number;
  applied: number;
  content: string;
  message: string;
}

interface ArtifactEditFailure {
  success: false;
  message: string;
  failedIndex?: number;
}

interface ArtifactEditRunOutcome {
  runStatus: 'completed' | 'failed' | 'cancelled';
  runExitCode: number | null;
  runErrorCode?: string;
  runErrorMessage?: string;
  runStdoutPreview: string;
  runStderrPreview: string;
  durationMs: number;
  files: Array<{
    name: string;
    storageId: string;
    fileMetadataId: string;
    size: number;
    contentType: string;
  }>;
  executionId: string;
}

interface ArtifactEditRunResult extends ArtifactEditRunOutcome {
  success: boolean;
  artifactId: string;
  revision: number;
  applied: number;
  content: string;
  message: string;
}

type ArtifactEditResult =
  | ArtifactEditSuccess
  | ArtifactEditFailure
  | ArtifactEditRunResult;

interface ExecuteCodeResult {
  executionId: string;
  success: boolean;
  status: 'completed' | 'failed' | 'cancelled';
  exitCode: number | null;
  errorCode?: string;
  errorMessage?: string;
  stdoutPreview: string;
  stderrPreview: string;
  durationMs: number;
  files: Array<{
    name: string;
    storageId: string;
    fileMetadataId: string;
    size: number;
    contentType: string;
  }>;
}

function mergeRunIntoEditResult(
  base: {
    artifactId: string;
    revision: number;
    applied: number;
    content: string;
  },
  baseMessage: string,
  run: ExecuteCodeResult,
): ArtifactEditRunResult {
  const completed = run.status === 'completed';
  const hasFiles = run.files.length > 0;
  const success = completed && hasFiles;
  // Compose a directive message: edit succeeded (baseMessage) PLUS run
  // outcome. The LLM uses this as its primary signal of what to tell the
  // user, so we must be explicit about failures.
  let message: string;
  if (success) {
    message = `${baseMessage} Ran the new revision; produced ${run.files.length} output file(s) in ${run.durationMs}ms.`;
  } else if (run.errorCode) {
    message = `${baseMessage} Re-run FAILED: ${run.errorCode}${run.errorMessage ? ` — ${run.errorMessage}` : ''}. Read runStderrPreview and call artifact_edit again to fix, or report the failure to the user. Do NOT say the file is ready.`;
  } else {
    message = `${baseMessage} Re-run produced no output files (status=${run.status}). Inspect stdout/stderr and decide next step.`;
  }
  return {
    success,
    artifactId: base.artifactId,
    revision: base.revision,
    applied: base.applied,
    content: base.content,
    message,
    runStatus: run.status,
    runExitCode: run.exitCode,
    ...(run.errorCode !== undefined && { runErrorCode: run.errorCode }),
    ...(run.errorMessage !== undefined && {
      runErrorMessage: run.errorMessage,
    }),
    runStdoutPreview: run.stdoutPreview,
    runStderrPreview: run.stderrPreview,
    durationMs: run.durationMs,
    files: run.files,
    executionId: run.executionId,
  };
}

export const artifactEditTool = {
  name: 'artifact_edit' as const,
  tool: createTool({
    description: `**artifact_edit** — modify an existing artifact in place. Use this — never \`artifact_create\` — to revise an artifact you've already created.

**MODES:**
- \`patch\` (preferred) — list of search/replace blocks. Each \`search\` must appear in the artifact verbatim and match exactly once; if not, the tool returns an error and you should re-emit a more specific snippet. Patches apply sequentially.
- \`rewrite\` — full replacement. Use only when more than ~50% of the file changes.

**SEARCH/REPLACE RULES:**
- The \`search\` block must match **exactly once** in the current artifact content. Zero matches and multiple matches both fail.
- Include enough surrounding context (a unique line or two) to make the snippet unique.
- Whitespace and newlines are significant. Do not normalise indentation.
- Empty \`replace\` deletes the matched range.

**ERROR HANDLING:**
- If a patch fails ("matched 0 times" / "matched more than once"), re-read the current artifact content from the <artifacts> system context, then re-emit the failing patch with a more specific search block. Do not fall back to \`mode: 'rewrite'\` unless the change is genuinely large.

**WHEN ADDING NEW FEATURES TO AN HTML ARTIFACT:** the same constraints from \`artifact_create\` apply — the iframe is offline (no \`fetch\` / WebSocket to any host), only the bundled \`/canvas-libs/*\` libraries are loadable, and features that need runtime intelligence (translate user input, score answers, conversational replies) belong in chat, not in the page. Don't introduce hardcoded lookup tables to fake AI behaviour.

**EDITING A RUNNABLE ARTIFACT** (\`python_runnable\` / \`node_runnable\`):

Editing a runnable artifact automatically re-runs it in the sandbox after the patch / rewrite settles. The previous run's \`runPackages\` / \`runOptions\` persist across edits — you do NOT re-specify packages. The same \`runStatus\` / \`runErrorCode\` / \`runStderrPreview\` / \`files[]\` block from \`artifact_create\` is returned here.

**On runnable-type response, INSPECT \`runStatus\` BEFORE replying:**

- \`runStatus: "completed"\` AND \`files.length > 0\` → tell the user the new revision is ready.
- \`runStatus: "failed"\` → READ \`runStderrPreview\`. Most likely another \`artifact_edit\` patch is needed to fix what the stderr identifies. \`runErrorCode\` recovery table (same as \`artifact_create\`):

| \`runErrorCode\` | Recovery |
|---|---|
| \`RUNTIME_ERROR\` | Read stderr traceback, another \`artifact_edit\` to fix |
| \`TIMEOUT\` | Another edit to split work / raise \`timeoutMs\` |
| \`OOM\` | Stream / reduce memory footprint |
| \`EGRESS_DENIED\` | Remove the external call — use \`web\` tool instead |
| \`INSTALL_FAILED\` / \`PACKAGE_NOT_FOUND\` | Fix the \`packages\` list via another edit |
| \`QUOTA_EXCEEDED\` | Stop — tell the user to wait |
| \`SPAWNER_UNAVAILABLE\` | Transient infra; one no-op rewrite retry is fine |

**NEVER tell the user "文件已生成" / "file generated" unless \`success === true\` AND \`files.length > 0\`.**

**RESPONSE:** returns the new \`revision\` number, how many patches were applied (\`applied\`), and the artifact's new \`content\` so you can reason about further edits in the same turn. For runnable types it also returns \`runStatus\`, \`runErrorCode\`, \`runStderrPreview\`, \`files[]\`, and \`executionId\`.`,
    inputSchema: artifactEditArgs,
    onInputStart: async (_ctx: ToolCtx, options: ToolExecutionOptions) => {
      initState(options.toolCallId, 'artifact_edit');
    },
    onInputDelta: async (
      ctx: ToolCtx,
      options: { inputTextDelta: string } & ToolExecutionOptions,
    ) => {
      const state = getState(options.toolCallId);
      if (!state) return;
      state.accumulator += options.inputTextDelta;

      if (!shouldParse(state, state.accumulator.length)) return;
      const parsed = await parsePartialJson(state.accumulator);
      markParsed(state, state.accumulator.length);
      if (
        parsed.state !== 'successful-parse' &&
        parsed.state !== 'repaired-parse'
      ) {
        return;
      }
      const partial = parsed.value;
      if (
        typeof partial !== 'object' ||
        partial === null ||
        Array.isArray(partial)
      ) {
        return;
      }
      const obj = partial as Record<string, unknown>;
      const artifactIdStr =
        typeof obj.artifactId === 'string' ? obj.artifactId : undefined;
      const mode = typeof obj.mode === 'string' ? obj.mode : undefined;

      // Defer the lookup until `mode` is also in the parsed object —
      // that's a structural signal the LLM closed the artifactId string
      // and moved to the next field. Without this guard parsePartialJson
      // hands back every streaming prefix ("k", "ks", "ks7", ...) and the
      // Convex `v.id("artifacts")` validator rejects each one as a
      // NonRetryableError that aborts the whole agent run.
      if (
        state.artifactId === undefined &&
        artifactIdStr &&
        mode !== undefined
      ) {
        try {
          const artifactId = toId<'artifacts'>(artifactIdStr);
          const artifact = await ctx.runQuery(
            internal.artifacts.internal_queries.getById,
            {
              artifactId,
              expectedOrganizationId: ctx.organizationId,
              expectedThreadId: ctx.threadId,
            },
          );
          if (!artifact) {
            // Defer error reporting to execute — avoids silently no-oping
            // when the LLM passes a bad ID; the tool result will explain.
            return;
          }
          state.artifactId = artifactId;
          state.baseContentLength = artifact.content.length;
        } catch (err) {
          // Malformed id (e.g. LLM hallucinated a token, or the parsed
          // string is still partial despite the mode-field guard).
          // Defer to execute for the canonical error message.
          console.warn('[artifact_edit] preflight getById failed, deferring', {
            artifactIdStr,
            error: err instanceof Error ? err.message : String(err),
          });
          return;
        }
      }

      if (
        state.artifactId !== undefined &&
        !state.rowInitialized &&
        (mode === 'patch' || mode === 'rewrite')
      ) {
        state.resolvedMode = mode;
        await ctx.runMutation(
          internal.artifacts.internal_mutations.beginEditStream,
          {
            artifactId: state.artifactId,
            liveStreamMode: mode,
            // Stamp the toolCallId so the canvas can filter
            // tool-input-deltas to this rewrite's stream. Patch mode also
            // gets it for symmetry / debugging — patch flushes still go
            // through `streamingPatches` independently.
            toolCallId: options.toolCallId,
          },
        );
        state.rowInitialized = true;
      }

      // Rewrite-mode partial content used to flush into `streamingContent`
      // here; we now skip that. The canvas reads the same partial bytes from
      // the agent SDK's tool-input-delta rows and decodes the JSON `content`
      // field client-side. The canonical settle in execute() still writes
      // the final `content` atomically via rewriteArtifact().

      if (
        state.resolvedMode === 'patch' &&
        state.artifactId !== undefined &&
        Array.isArray(obj.patches)
      ) {
        // Surface the partial patches as {search, replace} pairs so the
        // Canvas pane can render an inline diff preview. We only push
        // entries with a non-empty `search` — without that we cannot
        // anchor the diff anywhere in the source. `replace` may still be
        // streaming in (empty or partial); the renderer downgrades to a
        // strikethrough-only mark in that case and upgrades to full diff
        // once the replacement text arrives.
        const pairs: StreamingPatchPair[] = [];
        for (const item of obj.patches as readonly unknown[]) {
          if (!isRecord(item)) continue;
          const search = getString(item, 'search');
          if (search === undefined || search.length === 0) continue;
          const replace = getString(item, 'replace') ?? '';
          pairs.push({ search, replace });
        }
        if (shouldFlushStreamingPatches(state, pairs)) {
          markFlushedStreamingPatches(state, pairs);
          const artifactId = state.artifactId;
          const flushPairs = pairs;
          scheduleStreamingFlush(state, () =>
            ctx.runMutation(
              internal.artifacts.internal_mutations.updateStreamingContent,
              {
                artifactId,
                streamingPatches: flushPairs,
              },
            ),
          );
        }
      }
    },
    execute: async (
      ctx: ToolCtx,
      args: ArtifactEditInput,
      options: ToolExecutionOptions,
    ): Promise<ArtifactEditResult> => {
      const { messageId, organizationId, threadId, userId } = ctx;
      const editedByMessageId = messageId ?? '';
      const state = getState(options.toolCallId);

      // Re-execute a runnable artifact after the edit settles. Called by both
      // patch and rewrite success branches. The artifact row's `runPackages`
      // / `runOptions` / `runTimeoutMs` (if present) are reused so the LLM
      // doesn't need to re-specify them on every edit; if absent the
      // executeCode action's own defaults apply.
      const maybeRerun = async (
        artifactId: ReturnType<typeof toId<'artifacts'>>,
        type: string,
        title: string,
        newContent: string,
      ): Promise<ExecuteCodeResult | null> => {
        const language = runnableLanguage(type as never);
        if (!isRunnableArtifactType(type) || !language) return null;
        if (!organizationId || !threadId || !userId) return null;
        // Reload to pick up the latest runPackages / runOptions captured at
        // create time. These persist on the artifact row across edits.
        const fresh = await ctx.runQuery(
          internal.artifacts.internal_queries.getById,
          {
            artifactId,
            expectedOrganizationId: organizationId,
            expectedThreadId: threadId,
          },
        );
        if (!fresh) return null;
        await ctx.runMutation(
          internal.artifacts.internal_mutations.initArtifactRun,
          {
            artifactId,
            runPackages: fresh.runPackages ?? [],
            ...(fresh.runOptions !== undefined && {
              runOptions: fresh.runOptions,
            }),
          },
        );
        const raw: unknown = await ctx.runAction(
          internal.node_only.sandbox.internal_actions.executeCode,
          {
            organizationId,
            uploadedBy: userId,
            threadId,
            accessibleThreadIds: [threadId],
            ...(messageId !== undefined && { messageId }),
            ...(options.toolCallId && { toolCallId: options.toolCallId }),
            language,
            code: newContent,
            ...(fresh.runPackages !== undefined && {
              packages: fresh.runPackages,
            }),
            ...(fresh.runOptions?.allowSdist !== undefined && {
              allowSdist: fresh.runOptions.allowSdist,
            }),
            ...(fresh.runOptions?.allowInstallScripts !== undefined && {
              allowInstallScripts: fresh.runOptions.allowInstallScripts,
            }),
            purpose: `Re-run after edit: ${title}`,
            artifactId,
          },
        );
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- executeCode is typed `any` via the stale agent-SDK codegen path; the runtime shape is ExecuteCodeResult (asserted at the action return site).
        return raw as ExecuteCodeResult;
      };

      try {
        const artifactId = toId<'artifacts'>(args.artifactId);
        let artifact;
        try {
          artifact = await ctx.runQuery(
            internal.artifacts.internal_queries.getById,
            {
              artifactId,
              expectedOrganizationId: ctx.organizationId,
              expectedThreadId: ctx.threadId,
            },
          );
        } catch (err) {
          // Convex `v.id("artifacts")` rejected the value — most often
          // because the LLM hallucinated an id that doesn't match the
          // expected format. Returning a tool-result error keeps the
          // agent loop alive so the model can recover; throwing would
          // abort the whole run as a NonRetryableError.
          const message = err instanceof Error ? err.message : String(err);
          return {
            success: false,
            message: `Artifact id "${args.artifactId}" is malformed: ${message}`,
          };
        }
        if (!artifact) {
          return {
            success: false,
            message: `Artifact ${args.artifactId} not found in this thread.`,
          };
        }

        if (args.mode === 'patch') {
          const result = await ctx.runMutation(
            internal.artifacts.internal_mutations.applyToolPatches,
            {
              artifactId,
              patches: args.patches,
              editedByMessageId,
              expectedRevision: artifact.revision,
            },
          );
          if (!result.success) {
            await ctx.runMutation(
              internal.artifacts.internal_mutations.abortStream,
              { artifactId },
            );
            return {
              success: false,
              message: result.stale
                ? result.error
                : `Patch ${result.failedIndex + 1} failed: ${result.error}`,
              failedIndex: result.failedIndex,
            };
          }
          const run = await maybeRerun(
            artifactId,
            artifact.type,
            artifact.title,
            result.content,
          );
          const baseMessage = `Applied ${args.patches.length} patch(es) to "${artifact.title}". New revision: ${result.revision}.`;
          if (run) {
            return mergeRunIntoEditResult(
              {
                artifactId: args.artifactId,
                revision: result.revision,
                applied: args.patches.length,
                content: result.content,
              },
              baseMessage,
              run,
            );
          }
          return {
            success: true,
            artifactId: args.artifactId,
            revision: result.revision,
            applied: args.patches.length,
            content: result.content,
            message: baseMessage,
          };
        }

        const result = await ctx.runMutation(
          internal.artifacts.internal_mutations.rewriteArtifact,
          {
            artifactId,
            content: args.content,
            editedByMessageId,
            expectedRevision: artifact.revision,
          },
        );
        if (!result.success) {
          await ctx.runMutation(
            internal.artifacts.internal_mutations.abortStream,
            { artifactId },
          );
          return { success: false, message: result.error };
        }
        const run = await maybeRerun(
          artifactId,
          artifact.type,
          artifact.title,
          args.content,
        );
        const baseMessage = `Rewrote "${artifact.title}". New revision: ${result.revision}.`;
        if (run) {
          return mergeRunIntoEditResult(
            {
              artifactId: args.artifactId,
              revision: result.revision,
              applied: 1,
              content: args.content,
            },
            baseMessage,
            run,
          );
        }
        return {
          success: true,
          artifactId: args.artifactId,
          revision: result.revision,
          applied: 1,
          content: args.content,
          message: baseMessage,
        };
      } catch (err) {
        if (state?.artifactId !== undefined) {
          await ctx.runMutation(
            internal.artifacts.internal_mutations.abortStream,
            { artifactId: state.artifactId },
          );
        }
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, message: `artifact_edit failed: ${message}` };
      } finally {
        clearState(options.toolCallId);
      }
    },
  }),
} as const satisfies ToolDefinition;
