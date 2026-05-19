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
import { isRunnableArtifactType } from './shared';
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

type ArtifactEditResult = ArtifactEditSuccess | ArtifactEditFailure;

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

This tool patches the source but does **NOT** automatically re-execute. After a successful edit, call \`artifact_run({ artifactId })\` to run the new revision and produce updated output files. The artifact row's previously-configured \`runPackages\` / \`runOptions\` are reused automatically — you don't need to re-specify them.

**RESPONSE:** returns the new \`revision\` number, how many patches were applied (\`applied\`), and the artifact's new \`content\` so you can reason about further edits in the same turn.`,
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
      const { messageId } = ctx;
      const editedByMessageId = messageId ?? '';
      const state = getState(options.toolCallId);

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
          const baseMessage = isRunnableArtifactType(artifact.type)
            ? `Applied ${args.patches.length} patch(es) to "${artifact.title}". New revision: ${result.revision}. Call \`artifact_run\` with this artifactId to execute the patched script.`
            : `Applied ${args.patches.length} patch(es) to "${artifact.title}". New revision: ${result.revision}.`;
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
        const baseMessage = isRunnableArtifactType(artifact.type)
          ? `Rewrote "${artifact.title}". New revision: ${result.revision}. Call \`artifact_run\` with this artifactId to execute the rewritten script.`
          : `Rewrote "${artifact.title}". New revision: ${result.revision}.`;
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
