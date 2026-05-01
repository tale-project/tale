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

import { internal } from '../../_generated/api';
import { toId } from '../../lib/type_cast_helpers';
import type { ToolDefinition } from '../types';
import {
  clearState,
  getState,
  initState,
  markFlushed,
  shouldFlush,
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

      const parsed = await parsePartialJson(state.accumulator);
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

      if (state.artifactId === undefined && artifactIdStr) {
        const artifactId = toId<'artifacts'>(artifactIdStr);
        const artifact = await ctx.runQuery(
          internal.artifacts.internal_queries.getById,
          { artifactId },
        );
        if (
          !artifact ||
          (ctx.organizationId !== undefined &&
            artifact.organizationId !== ctx.organizationId)
        ) {
          // Defer error reporting to execute — avoids silently no-oping
          // when the LLM passes a bad ID; the tool result will explain.
          return;
        }
        state.artifactId = artifactId;
      }

      if (
        state.artifactId !== undefined &&
        !state.rowInitialized &&
        (mode === 'patch' || mode === 'rewrite')
      ) {
        state.resolvedMode = mode;
        await ctx.runMutation(
          internal.artifacts.internal_mutations.beginEditStream,
          { artifactId: state.artifactId, liveStreamMode: mode },
        );
        state.rowInitialized = true;
      }

      if (
        state.resolvedMode === 'rewrite' &&
        state.artifactId !== undefined &&
        typeof obj.content === 'string' &&
        shouldFlush(state, obj.content.length)
      ) {
        await ctx.runMutation(
          internal.artifacts.internal_mutations.updateStreamingContent,
          {
            artifactId: state.artifactId,
            streamingContent: obj.content,
          },
        );
        markFlushed(state, obj.content.length);
      }
    },
    execute: async (
      ctx: ToolCtx,
      args: ArtifactEditInput,
      options: ToolExecutionOptions,
    ): Promise<ArtifactEditResult> => {
      const { organizationId, messageId } = ctx;
      const editedByMessageId = messageId ?? '';
      const state = getState(options.toolCallId);
      try {
        const artifactId = toId<'artifacts'>(args.artifactId);
        const artifact = await ctx.runQuery(
          internal.artifacts.internal_queries.getById,
          { artifactId },
        );
        if (!artifact) {
          return {
            success: false,
            message: `Artifact ${args.artifactId} not found.`,
          };
        }
        if (
          organizationId !== undefined &&
          artifact.organizationId !== organizationId
        ) {
          return {
            success: false,
            message: `Artifact ${args.artifactId} does not belong to the current organization.`,
          };
        }

        if (args.mode === 'patch') {
          const result = await ctx.runMutation(
            internal.artifacts.internal_mutations.applyToolPatches,
            {
              artifactId,
              patches: args.patches,
              editedByMessageId,
            },
          );
          if (!result.success) {
            await ctx.runMutation(
              internal.artifacts.internal_mutations.abortStream,
              { artifactId },
            );
            return {
              success: false,
              message: `Patch ${result.failedIndex + 1} failed: ${result.error}`,
              failedIndex: result.failedIndex,
            };
          }
          return {
            success: true,
            artifactId: args.artifactId,
            revision: result.revision,
            applied: args.patches.length,
            content: result.content,
            message: `Applied ${args.patches.length} patch(es) to "${artifact.title}". New revision: ${result.revision}.`,
          };
        }

        const result = await ctx.runMutation(
          internal.artifacts.internal_mutations.rewriteArtifact,
          {
            artifactId,
            content: args.content,
            editedByMessageId,
          },
        );
        return {
          success: true,
          artifactId: args.artifactId,
          revision: result.revision,
          applied: 1,
          content: args.content,
          message: `Rewrote "${artifact.title}". New revision: ${result.revision}.`,
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
