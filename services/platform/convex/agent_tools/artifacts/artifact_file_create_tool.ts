/**
 * Convex Tool: artifact_file_create
 *
 * Add a NEW file to an artifact's project tree. Refused if `path` already
 * exists (use `artifact_file_update` to overwrite). Streams content live to the
 * canvas via the shared streaming mutations.
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

const fileCreateArgs = z.object({
  artifactId: z
    .string()
    .min(1)
    .describe(
      'Convex artifact ID returned by `artifact_create` (or referenced from the <artifacts> system context).',
    ),
  path: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'New file path inside the artifact. Must NOT already exist (use `artifact_file_update` to overwrite an existing file).',
    ),
  content: z
    .string()
    .describe(
      'Complete content for the new file. Empty string is allowed (creates a placeholder).',
    ),
  expectedRevision: z
    .number()
    .int()
    .nonnegative()
    .describe(
      'REQUIRED: the `revision="N"` attribute from the `<artifact>` block this create was authored against. OCC — rejects with `code: "stale"` and `currentRevision` if the artifact has moved.',
    ),
  packages_add: z
    .array(z.string().max(120))
    .max(20)
    .optional()
    .describe(
      "Optional. Package names to UNION into the artifact's persistent `runPackages` list so the next `artifact_run` auto-installs them. Use when the new file imports a new dependency. Equivalent to a follow-up `artifact_packages_add` call.",
    ),
});

type FileCreateInput = z.infer<typeof fileCreateArgs>;

interface FileCreateSuccess {
  success: true;
  artifactId: string;
  revision: number;
  path: string;
  byteLength: number;
  message: string;
}

interface FileCreateFailure {
  success: false;
  code?: string;
  message: string;
  currentRevision?: number;
}

type FileCreateResult = FileCreateSuccess | FileCreateFailure;

export const artifactFileCreateTool = {
  name: 'artifact_file_create' as const,
  tool: createTool({
    description: `**artifact_file_create** — add a NEW file to an artifact's project tree. Streams content live to the canvas. Use this — NOT \`artifact_file_update\` — for paths that don't yet exist.

**INPUTS:** \`artifactId\`, \`path\`, \`content\` (full file), \`expectedRevision\`, optional \`packages_add\`.

**REFUSED ON** existing path (code: \`path_exists\`) — call \`artifact_file_update\` to overwrite, or pick a different name.

**SIZE LIMIT (HARD):** The \`content\` field is sent as a JSON string literal inside this call's arguments — every byte of \`content\` consumes YOUR (the caller's) output token budget. If \`content\` exceeds your remaining budget, the arguments JSON gets truncated mid-string by \`max_tokens\` and the call fails with an unrecoverable parse error BEFORE this handler runs. To stay safe, keep any single \`content\` under ~12 KB (~400 lines). When the file you want to write would exceed that, decide on a split BEFORE generating the call:
 - Slide decks (pptxgenjs etc.) → \`main.js\` requires \`slide1.js\`, \`slide2.js\`, …, one builder per file.
 - Long scripts → split by module/responsibility into multiple files (e.g. \`main.py\` + \`helpers.py\` + \`types.py\`).
 - Long data tables → put each chunk in its own data file and import them.
There is no \`append\` and no patch mode — splitting is the only way. This is a HARD limit of the calling protocol, not a soft preference. (Per-artifact aggregate cap is ~800 KB across all files.)

**RUNNABLE ARTIFACTS:** if the new file imports a new dependency, set \`packages_add\` (or follow up with \`artifact_packages_add\`). Edits do NOT auto-execute — call \`artifact_run\` to re-run.

**RESPONSE:** \`{revision, path, byteLength, message}\`. Errors carry \`code\` (\`not_found\`, \`stale\`, \`path_exists\`, \`streaming_in_progress\`, \`too_large\`).`,
    inputSchema: fileCreateArgs,
    onInputStart: async (_ctx: ToolCtx, options: ToolExecutionOptions) => {
      initState(options.toolCallId, 'artifact_file_create');
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
            '[artifact_file_create] preflight getById failed, deferring',
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
            '[artifact_file_create] beginEditStream failed, deferring',
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
        console.warn('[artifact_file_create] streamingContent flush failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    execute: async (
      ctx: ToolCtx,
      args: FileCreateInput,
      options: ToolExecutionOptions,
    ): Promise<FileCreateResult> => {
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
          internal.artifacts.internal_mutations.createFileInArtifact,
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
          message: `Created file "${result.path}" in "${artifact.title}" (${result.byteLength} bytes). New revision: ${result.revision}.${pkgNote}${runHint}`,
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
          message: `artifact_file_create failed: ${message}`,
        };
      } finally {
        clearState(options.toolCallId);
      }
    },
  }),
} as const satisfies ToolDefinition;
