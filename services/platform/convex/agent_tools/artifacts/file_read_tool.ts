/**
 * Convex Tool: file_read
 *
 * Read explicit file path(s) from an artifact. Required `path` — no "no path
 * → smart inline aggregate" branch. Call `file_list` first if you need to
 * enumerate available paths.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import type { ToolExecutionOptions } from 'ai';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { toId } from '../../lib/type_cast_helpers';
import type { ToolDefinition } from '../types';

const AGGREGATE_INLINE_BYTES = 65_536;

const fileReadArgs = z.object({
  artifactId: z
    .string()
    .min(1)
    .describe(
      'Convex artifact ID. Look it up via `artifact_list({})` if you only have the title.',
    ),
  path: z
    .union([z.string().min(1), z.array(z.string().min(1)).min(1).max(50)])
    .describe(
      'REQUIRED. A single file path (string) to fetch in full, or an array of paths to fetch several at once (subject to an aggregate ~64KB cap). To enumerate available paths first, call `file_list`.',
    ),
});

type FileReadInput = z.infer<typeof fileReadArgs>;

interface ReadFileEntry {
  path: string;
  size: number;
  content?: string;
}

interface FileReadSuccess {
  success: true;
  artifactId: string;
  type: string;
  title: string;
  revision: number;
  entryFile: string;
  language?: string;
  files: ReadFileEntry[];
  truncated: boolean;
  message?: string;
}

interface FileReadFailure {
  success: false;
  code?: string;
  message: string;
}

type FileReadResult = FileReadSuccess | FileReadFailure;

export const fileReadTool = {
  name: 'file_read' as const,
  tool: createTool({
    description: `**file_read** — fetch file content by exact path(s). \`path\` is REQUIRED (string or string[]). To enumerate available paths first, call \`file_list\`.

**INPUTS:**
- \`artifactId\` — required.
- \`path\` — required. Either a single \`string\` (returns that one file's full content) or a \`string[]\` (returns those files; aggregate ≤${AGGREGATE_INLINE_BYTES} bytes — anything over the cap comes back as \`{path, size}\` with no content; re-read by single path to fetch it).

**WHEN TO USE:**
- Before \`file_update\` when your snapshot of a file may be stale.
- Before composing a multi-step edit that references several files.
- When the \`<artifacts>\` system-context block was truncated.

**RESPONSE:** \`{artifactId, type, title, revision, entryFile, files: [{path, size, content?}], truncated}\`. \`content\` is present iff the file fit under the inline thresholds. Use \`revision\` as the \`expectedRevision\` for any subsequent write.`,
    inputSchema: fileReadArgs,
    execute: async (
      ctx: ToolCtx,
      args: FileReadInput,
      _options: ToolExecutionOptions,
    ): Promise<FileReadResult> => {
      const { organizationId, threadId } = ctx;
      if (!organizationId || !threadId) {
        return {
          success: false,
          message:
            'file_read requires organizationId and threadId in the tool context.',
        };
      }
      let artifactId;
      try {
        artifactId = toId<'artifacts'>(args.artifactId);
      } catch (err) {
        return {
          success: false,
          message: `Artifact id "${args.artifactId}" is malformed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      const paths = typeof args.path === 'string' ? [args.path] : args.path;
      const result = await ctx.runQuery(
        internal.artifacts.internal_queries.getFilesByPaths,
        {
          artifactId,
          paths,
          expectedOrganizationId: organizationId,
          expectedThreadId: threadId,
        },
      );
      if (!result) {
        return {
          success: false,
          code: 'not_found',
          message: `Artifact ${args.artifactId} not found in this thread.`,
        };
      }
      if (result.missing.length > 0) {
        return {
          success: false,
          code: 'file_missing',
          message: `These paths do not exist: ${result.missing.join(', ')}. Available: ${result.availablePaths.join(', ')}.`,
        };
      }

      // Single-path read: never truncate the caller's explicit ask.
      if (typeof args.path === 'string') {
        const f = result.files[0];
        return {
          success: true,
          artifactId: args.artifactId,
          type: result.type,
          title: result.title,
          revision: result.revision,
          entryFile: result.entryFile,
          language: result.language,
          files: [{ path: f.path, size: f.content.length, content: f.content }],
          truncated: false,
        };
      }

      // Multi-path: smallest-first so a single large file doesn't push everything out.
      let aggregate = 0;
      let truncated = false;
      const indexByPath = new Map<string, number>();
      result.files.forEach((f, i) => indexByPath.set(f.path, i));
      const ordered = [...result.files].sort(
        (a, b) => a.content.length - b.content.length,
      );
      const byPath = new Map<string, ReadFileEntry>();
      for (const f of ordered) {
        if (aggregate + f.content.length > AGGREGATE_INLINE_BYTES) {
          byPath.set(f.path, { path: f.path, size: f.content.length });
          truncated = true;
          continue;
        }
        aggregate += f.content.length;
        byPath.set(f.path, {
          path: f.path,
          size: f.content.length,
          content: f.content,
        });
      }
      const files = args.path
        .map((p) => byPath.get(p))
        .filter((x): x is ReadFileEntry => x !== undefined);
      return {
        success: true,
        artifactId: args.artifactId,
        type: result.type,
        title: result.title,
        revision: result.revision,
        entryFile: result.entryFile,
        language: result.language,
        files,
        truncated,
        message: truncated
          ? 'Some files exceeded the aggregate inline cap; re-read by single path to fetch them.'
          : undefined,
      };
    },
  }),
} as const satisfies ToolDefinition;
