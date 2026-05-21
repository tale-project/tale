/**
 * Convex Tool: artifact_edit
 *
 * Modifies an existing artifact project. Five modes:
 *   - rewrite    — write the whole content of one file (creates file if missing)
 *   - patch      — one search/replace on one file (optional replaceAll)
 *   - delete     — remove one file (refuses on entryFile and on last-file)
 *   - rename     — rename a file; atomically repoints entryFile if matched
 *   - set_entry  — repoint entryFile pointer without touching file content
 *
 * Streaming applies only to `rewrite` content. Other modes settle synchronously.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import type { ToolExecutionOptions } from 'ai';
import { parsePartialJson } from 'ai';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { toId } from '../../lib/type_cast_helpers';
import type { ToolDefinition } from '../types';
import { isRunnableArtifactType } from './shared';
import {
  clearState,
  getState,
  initState,
  markParsed,
  shouldParse,
} from './stream_state';

const rewriteModeArgs = z.object({
  artifactId: z
    .string()
    .min(1)
    .describe(
      'Convex artifact ID returned by `artifact_create` (or referenced from the <artifacts> system context).',
    ),
  mode: z.literal('rewrite'),
  path: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'File path inside the artifact. If the path does not yet exist in the project, it is created. Use the entry file path (from `<artifact entryFile="...">`) to overwrite the main file.',
    ),
  content: z
    .string()
    .describe(
      'Complete new content for the file. Empty string is allowed only on first write (file becomes a placeholder); prefer `mode="delete"` to remove a file.',
    ),
  expectedRevision: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      'OPTIONAL but strongly recommended: the `revision="N"` attribute from the `<artifact>` block this edit was authored against. Pass back to detect concurrent edits.',
    ),
});

const patchModeArgs = z.object({
  artifactId: z.string().min(1),
  mode: z.literal('patch'),
  path: z
    .string()
    .min(1)
    .max(200)
    .describe('File path inside the artifact to patch.'),
  search: z
    .string()
    .min(1)
    .describe(
      'Snippet that appears verbatim in the file and matches **exactly once** (unless `replaceAll: true`). Include enough surrounding context (a unique line or two) to make the snippet unique. Whitespace and newlines are significant.',
    ),
  replace: z
    .string()
    .describe('Replacement text. Empty string deletes the matched range.'),
  replaceAll: z
    .boolean()
    .optional()
    .describe(
      'Default false (exactly-once match). Set true to replace ALL occurrences of `search` in the file.',
    ),
  expectedRevision: z.number().int().nonnegative().optional(),
});

const deleteModeArgs = z.object({
  artifactId: z.string().min(1),
  mode: z.literal('delete'),
  path: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'File path inside the artifact to delete. Refused on the entry file (call `mode="set_entry"` or `mode="rename"` first) and on the last file in the artifact.',
    ),
  expectedRevision: z.number().int().nonnegative().optional(),
});

const renameModeArgs = z.object({
  artifactId: z.string().min(1),
  mode: z.literal('rename'),
  from: z.string().min(1).max(200).describe('Existing file path to rename.'),
  to: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'New file path. Must not already exist (use `mode="delete"` first if you intend to replace).',
    ),
  expectedRevision: z.number().int().nonnegative().optional(),
});

const setEntryModeArgs = z.object({
  artifactId: z.string().min(1),
  mode: z.literal('set_entry'),
  entryFile: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'Path to the existing file that should become the new entry point. Must already exist in the artifact.',
    ),
  expectedRevision: z.number().int().nonnegative().optional(),
});

const artifactEditArgs = z.discriminatedUnion('mode', [
  rewriteModeArgs,
  patchModeArgs,
  deleteModeArgs,
  renameModeArgs,
  setEntryModeArgs,
]);

type ArtifactEditInput = z.infer<typeof artifactEditArgs>;

interface ArtifactEditSuccess {
  success: true;
  artifactId: string;
  revision: number;
  path?: string;
  entryFile?: string;
  matchCount?: number;
  created?: boolean;
  message: string;
}

interface ArtifactEditFailure {
  success: false;
  code?: string;
  message: string;
  currentRevision?: number;
  entryFile?: string;
  matchCount?: number;
}

type ArtifactEditResult = ArtifactEditSuccess | ArtifactEditFailure;

export const artifactEditTool = {
  name: 'artifact_edit' as const,
  tool: createTool({
    description: `**artifact_edit** — modify an existing artifact project. Use this — never \`artifact_create\` — to revise an artifact you've already created.

**FIVE MODES:**

- \`rewrite\` — write the whole content of one file. Creates the file if its \`path\` doesn't exist yet. Use this to add new files to a multi-file project, or to replace a file entirely.
- \`patch\` — one search/replace on one file. **Single patch per call** (no batching). Default exactly-once match; pass \`replaceAll: true\` for multi-site replace.
- \`delete\` — remove one file from the project. Refused on the \`entryFile\` and on the last file in the artifact.
- \`rename\` — rename one file. If \`from === entryFile\`, the entry pointer atomically moves to \`to\`.
- \`set_entry\` — repoint the entry-file pointer without touching file content. The target path must already exist in the project.

**PATCH-MODE RULES** (mode='patch'):
- \`search\` must match the file's content **verbatim**. Whitespace and newlines are significant.
- Default: matches **exactly once** in the file. Zero matches → \`matchCount: 0\` error. Multiple matches → \`ambiguous_match\` error.
- Set \`replaceAll: true\` to replace every occurrence (use for identifier renames within a file).
- Include enough surrounding context (a unique line or two) to make the snippet unique. Don't use overly-short \`search\` strings.
- If a patch fails with \`matchCount: 0\` or \`ambiguous_match\`, call \`artifact_read({artifactId, path})\` before retrying — your snapshot of the file is stale or imprecise.

**EXAMPLE patch:**
\`\`\`
{ mode: "patch", artifactId: "...", path: "main.py", expectedRevision: 3,
  search: "def greet(name):\\n    print(f'Hello, {name}!')",
  replace: "def greet(name):\\n    print(f'Hi, {name}!')" }
\`\`\`

**EXAMPLE rewrite (add new file):**
\`\`\`
{ mode: "rewrite", artifactId: "...", path: "helpers.py", expectedRevision: 3,
  content: "def format_name(n):\\n    return n.strip().title()\\n" }
\`\`\`

**RUNNABLE ARTIFACTS:** edits do NOT auto-execute. After modifying source, call \`artifact_run({artifactId})\` to re-execute the project and refresh outputs. The artifact's \`runPackages\` persist across runs.

**HTML CONSTRAINTS:** when editing an \`html\` artifact's entry file or its sibling files, the iframe is still offline-only — no \`https://\` URLs, only bundled \`/canvas-libs/*\` resources. Sibling subresources (\`<link>\`, \`<script>\`, \`<img>\`) are inlined by the preview server; no dynamic \`fetch()\` between files.

**RESPONSE:**
- \`rewrite\` → \`{revision, path, created, message}\`
- \`patch\` → \`{revision, path, matchCount, message}\`
- \`delete\` → \`{revision, path, message}\`
- \`rename\` → \`{revision, entryFile (may have moved), message}\`
- \`set_entry\` → \`{revision, entryFile, message}\`

**ERRORS** carry \`code\` (e.g. \`stale\`, \`file_missing\`, \`no_match\`, \`ambiguous_match\`, \`entry_pin\`, \`last_file\`, \`path_exists\`) plus a recovery message. On \`stale\` the response includes \`currentRevision\` — re-read the artifact and retry.`,
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
      const path = typeof obj.path === 'string' ? obj.path : undefined;

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
          if (!artifact) return;
          state.artifactId = artifactId;
          state.baseContentLength = (artifact.content ?? '').length;
        } catch (err) {
          console.warn('[artifact_edit] preflight getById failed, deferring', {
            artifactIdStr,
            error: err instanceof Error ? err.message : String(err),
          });
          return;
        }
      }

      // Only mark the row as streaming for `rewrite` mode (where content
      // arrives token-by-token). The other modes settle synchronously at
      // execute time and don't need a streaming placeholder.
      if (
        state.artifactId !== undefined &&
        !state.rowInitialized &&
        mode === 'rewrite' &&
        path !== undefined &&
        path.length > 0
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
          // Most likely: streaming_in_progress because another edit is
          // already live. Defer error reporting to execute.
          console.warn('[artifact_edit] beginEditStream rejected, deferring', {
            error: err instanceof Error ? err.message : String(err),
          });
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

        const baselineRevision = args.expectedRevision ?? artifact.revision;
        const isRunnable = isRunnableArtifactType(artifact.type);
        const runHint = isRunnable
          ? ` Call \`artifact_run({artifactId: "${args.artifactId}"})\` to execute the updated project.`
          : '';

        switch (args.mode) {
          case 'rewrite': {
            const result = await ctx.runMutation(
              internal.artifacts.internal_mutations.rewriteArtifact,
              {
                artifactId,
                path: args.path,
                content: args.content,
                editedByMessageId,
                expectedRevision: baselineRevision,
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
            return {
              success: true,
              artifactId: args.artifactId,
              revision: result.revision,
              path: result.path,
              created: result.created,
              message: result.created
                ? `Created file "${result.path}" in "${artifact.title}". New revision: ${result.revision}.${runHint}`
                : `Rewrote "${result.path}" in "${artifact.title}". New revision: ${result.revision}.${runHint}`,
            };
          }
          case 'patch': {
            const result = await ctx.runMutation(
              internal.artifacts.internal_mutations.applyToolPatch,
              {
                artifactId,
                path: args.path,
                search: args.search,
                replace: args.replace,
                replaceAll: args.replaceAll,
                editedByMessageId,
                expectedRevision: baselineRevision,
              },
            );
            if (!result.success) {
              return {
                success: false,
                code: result.code,
                message: result.message,
                currentRevision: result.currentRevision,
                matchCount: result.matchCount,
              };
            }
            return {
              success: true,
              artifactId: args.artifactId,
              revision: result.revision,
              path: result.path,
              matchCount: result.matchCount,
              message: `Patched "${result.path}" in "${artifact.title}" (${result.matchCount} match${result.matchCount === 1 ? '' : 'es'} replaced). New revision: ${result.revision}.${runHint}`,
            };
          }
          case 'delete': {
            const result = await ctx.runMutation(
              internal.artifacts.internal_mutations.deleteFileFromArtifact,
              {
                artifactId,
                path: args.path,
                editedByMessageId,
                expectedRevision: baselineRevision,
              },
            );
            if (!result.success) {
              return {
                success: false,
                code: result.code,
                message: result.message,
                currentRevision: result.currentRevision,
                entryFile: result.entryFile,
              };
            }
            return {
              success: true,
              artifactId: args.artifactId,
              revision: result.revision,
              path: result.path,
              message: `Deleted "${result.path}" from "${artifact.title}". New revision: ${result.revision}.`,
            };
          }
          case 'rename': {
            const result = await ctx.runMutation(
              internal.artifacts.internal_mutations.renameFileInArtifact,
              {
                artifactId,
                from: args.from,
                to: args.to,
                editedByMessageId,
                expectedRevision: baselineRevision,
              },
            );
            if (!result.success) {
              return {
                success: false,
                code: result.code,
                message: result.message,
                currentRevision: result.currentRevision,
              };
            }
            const entryNote = result.entryUpdated
              ? ' Entry file repointed accordingly.'
              : '';
            return {
              success: true,
              artifactId: args.artifactId,
              revision: result.revision,
              path: result.to,
              entryFile: result.entryFile,
              message: `Renamed "${result.from}" → "${result.to}" in "${artifact.title}". New revision: ${result.revision}.${entryNote}`,
            };
          }
          case 'set_entry': {
            const result = await ctx.runMutation(
              internal.artifacts.internal_mutations.setArtifactEntry,
              {
                artifactId,
                entryFile: args.entryFile,
                editedByMessageId,
                expectedRevision: baselineRevision,
              },
            );
            if (!result.success) {
              return {
                success: false,
                code: result.code,
                message: result.message,
                currentRevision: result.currentRevision,
              };
            }
            return {
              success: true,
              artifactId: args.artifactId,
              revision: result.revision,
              entryFile: result.entryFile,
              message: `Set entry file to "${result.entryFile}" in "${artifact.title}". New revision: ${result.revision}.${runHint}`,
            };
          }
          default: {
            // Exhaustive switch over the discriminated union — TS narrows
            // `args` to `never` here. Defensive return for oxlint.
            const _exhaustive: never = args;
            void _exhaustive;
            return {
              success: false,
              message: 'artifact_edit: unhandled mode.',
            };
          }
        }
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
