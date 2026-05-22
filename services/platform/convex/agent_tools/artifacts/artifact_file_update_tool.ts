/**
 * Convex Tool: artifact_file_update
 *
 * Overwrite an EXISTING file in an artifact's project tree. Refused if `path`
 * does not exist (use `artifact_file_create` instead). Pure overwrite — no append, no
 * patch. Streams content live to the canvas via the shared streaming
 * mutations.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import type { ToolExecutionOptions } from 'ai';
import { parsePartialJson } from 'ai';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { toId } from '../../lib/type_cast_helpers';
import type { ToolDefinition } from '../types';
import { applyPackagesAddIfAny, isStringFieldClosed } from './_packages_helper';
import { isRunnableArtifactType } from './shared';
import {
  clearState,
  getState,
  initState,
  markFlushed,
  markParsed,
  shouldFlush,
  shouldParse,
} from './stream_state';

const fileUpdateArgs = z.object({
  artifactId: z.string().min(1),
  path: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'Existing file path inside the artifact. Use `artifact_file_create` to add a new file.',
    ),
  content: z
    .string()
    .describe(
      'Complete replacement content for the file. The previous content is fully replaced — there is no append or patch mode.',
    ),
  expectedRevision: z
    .number()
    .int()
    .nonnegative()
    .describe(
      'REQUIRED: the `revision="N"` attribute from the `<artifact>` block this update was authored against. OCC — rejects with `code: "stale"` and `currentRevision` if the artifact has moved.',
    ),
  packages_add: z
    .array(z.string().max(120))
    .max(20)
    .optional()
    .describe(
      "Optional. Package names to UNION into the artifact's persistent `runPackages` list so the next `artifact_run` auto-installs them. Use when the updated file imports a new dependency. Equivalent to a follow-up `artifact_packages_add` call.",
    ),
});

type FileUpdateInput = z.infer<typeof fileUpdateArgs>;

interface FileUpdateSuccess {
  success: true;
  artifactId: string;
  revision: number;
  path: string;
  byteLength: number;
  message: string;
}

interface FileUpdateFailure {
  success: false;
  code?: string;
  message: string;
  currentRevision?: number;
}

type FileUpdateResult = FileUpdateSuccess | FileUpdateFailure;

export const artifactFileUpdateTool = {
  name: 'artifact_file_update' as const,
  tool: createTool({
    description: `**artifact_file_update** — overwrite an EXISTING file in an artifact's project tree with full new content. Streams content live to the canvas. Pure overwrite — no append, no patch.

**INPUTS:** \`artifactId\`, \`path\`, \`content\` (full file), \`expectedRevision\`, optional \`packages_add\`.

**REFUSED ON** missing path (code: \`file_missing\`) — call \`artifact_file_create\` to add a new file, or \`artifact_file_list\` to see what exists.

**PROJECT-FILE GUIDANCE:** This tool overwrites the file in full. To grow a project, prefer adding NEW files via \`artifact_file_create\` calls over making one file enormous. There is no \`append\` — write each file in one \`artifact_file_create\` / \`artifact_file_update\` call. If your snapshot is stale, call \`artifact_file_read\` first to anchor against current bytes.

**RUNNABLE ARTIFACTS:** if the updated file imports a new dependency, set \`packages_add\` (or follow up with \`artifact_packages_add\`). Edits do NOT auto-execute — call \`artifact_run\` to re-run.

**RESPONSE:** \`{revision, path, byteLength, message}\`. Errors carry \`code\` (\`not_found\`, \`stale\`, \`file_missing\`, \`streaming_in_progress\`, \`too_large\`).`,
    inputSchema: fileUpdateArgs,
    onInputStart: async (_ctx: ToolCtx, options: ToolExecutionOptions) => {
      initState(options.toolCallId, 'artifact_file_update');
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
      const path = typeof obj.path === 'string' ? obj.path : undefined;

      if (
        state.artifactId === undefined &&
        artifactIdStr &&
        isStringFieldClosed(state.accumulator, 'artifactId')
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
          if (!artifact) return;
          state.artifactId = artifactId;
          state.baseContentLength = (artifact.content ?? '').length;
        } catch (err) {
          console.warn(
            '[artifact_file_update] preflight getById failed, deferring',
            {
              artifactIdStr,
              error: err instanceof Error ? err.message : String(err),
            },
          );
          return;
        }
      }

      if (
        state.artifactId !== undefined &&
        !state.rowInitialized &&
        path !== undefined &&
        path.length > 0 &&
        isStringFieldClosed(state.accumulator, 'path')
      ) {
        state.resolvedMode = 'rewrite';
        try {
          await ctx.runMutation(
            internal.artifacts.internal_mutations.beginEditStream,
            {
              artifactId: state.artifactId,
              liveStreamMode: 'rewrite',
              streamingPath: path,
              toolCallId: options.toolCallId,
            },
          );
          state.rowInitialized = true;
        } catch (err) {
          // Defensive: beginEditStream only throws `not_found` now (mutex
          // removed). execute() will surface that via its own preflight.
          console.warn(
            '[artifact_file_update] beginEditStream failed, deferring',
            {
              error: err instanceof Error ? err.message : String(err),
            },
          );
          return;
        }
      }

      if (
        !state.rowInitialized ||
        state.artifactId === undefined ||
        path === undefined ||
        path.length === 0
      ) {
        return;
      }
      const contentRaw =
        typeof obj.content === 'string' ? obj.content : undefined;
      if (contentRaw === undefined) return;
      if (!shouldFlush(state, contentRaw.length)) return;
      try {
        await ctx.runMutation(
          internal.artifacts.internal_mutations.updateRewriteStreamingContent,
          {
            artifactId: state.artifactId,
            toolCallId: options.toolCallId,
            streamingPath: path,
            content: contentRaw,
          },
        );
        markFlushed(state, contentRaw.length);
      } catch (err) {
        console.warn('[artifact_file_update] streamingContent flush failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    execute: async (
      ctx: ToolCtx,
      args: FileUpdateInput,
      options: ToolExecutionOptions,
    ): Promise<FileUpdateResult> => {
      const { messageId } = ctx;
      const editedByMessageId = messageId ?? '';
      const state = getState(options.toolCallId);
      try {
        const artifactId = toId<'artifacts'>(args.artifactId);
        const artifact = await ctx.runQuery(
          internal.artifacts.internal_queries.getById,
          {
            artifactId,
            expectedOrganizationId: ctx.organizationId,
            expectedThreadId: ctx.threadId,
          },
        );
        if (!artifact) {
          return {
            success: false,
            code: 'not_found',
            message: `Artifact ${args.artifactId} not found in this thread.`,
          };
        }
        const isRunnable = isRunnableArtifactType(artifact.type);
        const runHint = isRunnable
          ? ` Call \`artifact_run({artifactId: "${args.artifactId}"})\` to execute the updated project.`
          : '';
        const result = await ctx.runMutation(
          internal.artifacts.internal_mutations.updateFileInArtifact,
          {
            artifactId,
            path: args.path,
            content: args.content,
            editedByMessageId,
            expectedRevision: args.expectedRevision,
          },
        );
        if (!result.success) {
          await ctx.runMutation(
            internal.artifacts.internal_mutations.abortStream,
            { artifactId },
          );
          return {
            success: false,
            code: result.code,
            message: result.message,
            currentRevision: result.currentRevision,
          };
        }
        const pkgNote = await applyPackagesAddIfAny(
          ctx,
          artifactId,
          isRunnable,
          args.packages_add,
        );
        return {
          success: true,
          artifactId: args.artifactId,
          revision: result.revision,
          path: result.path,
          byteLength: result.byteLength,
          message: `Updated "${result.path}" in "${artifact.title}" (${result.byteLength} bytes). New revision: ${result.revision}.${pkgNote}${runHint}`,
        };
      } catch (err) {
        if (state?.artifactId !== undefined) {
          await ctx.runMutation(
            internal.artifacts.internal_mutations.abortStream,
            { artifactId: state.artifactId },
          );
        }
        const message = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          message: `artifact_file_update failed: ${message}`,
        };
      } finally {
        clearState(options.toolCallId);
      }
    },
  }),
} as const satisfies ToolDefinition;
