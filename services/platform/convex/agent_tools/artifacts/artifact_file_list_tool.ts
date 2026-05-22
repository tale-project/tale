/**
 * Convex Tool: artifact_file_list
 *
 * List metadata for every file in an artifact's project tree. Cheap; encourages
 * the "list-then-read" CRUD pattern (call `artifact_file_list` first to enumerate paths,
 * then `artifact_file_read` with explicit paths to fetch content).
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import type { ToolExecutionOptions } from 'ai';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { toId } from '../../lib/type_cast_helpers';
import type { ToolDefinition } from '../types';

const fileListArgs = z.object({
  artifactId: z
    .string()
    .min(1)
    .describe(
      'Convex artifact ID returned by `artifact_create` (or referenced from the <artifacts> system context).',
    ),
});

type FileListInput = z.infer<typeof fileListArgs>;

interface FileListSuccess {
  success: true;
  artifactId: string;
  type: string;
  title: string;
  revision: number;
  entryFile: string;
  language?: string;
  files: { path: string; size: number }[];
}

interface FileListFailure {
  success: false;
  code?: string;
  message: string;
}

type FileListResult = FileListSuccess | FileListFailure;

export const artifactFileListTool = {
  name: 'artifact_file_list' as const,
  tool: createTool({
    description: `**artifact_file_list** — list every file in an artifact's project tree as \`{path, size}\` metadata (no content). Cheap; use to enumerate before \`artifact_file_read\`.

**INPUTS:** \`artifactId\` (required).

**WHEN TO USE:**
- Before \`artifact_file_read\` when you need to see what files exist.
- After a failed \`artifact_file_update\` reporting \`file_missing\` — to see the correct paths.
- When the \`<artifacts>\` system context was truncated and you need a fresh view.

**RESPONSE:** \`{artifactId, type, title, revision, entryFile, files: [{path, size}]}\`. Use \`revision\` as \`expectedRevision\` on the next write call.`,
    inputSchema: fileListArgs,
    execute: async (
      ctx: ToolCtx,
      args: FileListInput,
      _options: ToolExecutionOptions,
    ): Promise<FileListResult> => {
      const { organizationId, threadId } = ctx;
      if (!organizationId || !threadId) {
        return {
          success: false,
          message:
            'artifact_file_list requires organizationId and threadId in the tool context.',
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
      const result = await ctx.runQuery(
        internal.artifacts.internal_queries.listFilesByArtifact,
        {
          artifactId,
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
      return {
        success: true,
        artifactId: args.artifactId,
        type: result.type,
        title: result.title,
        revision: result.revision,
        entryFile: result.entryFile,
        language: result.language,
        files: result.files,
      };
    },
  }),
} as const satisfies ToolDefinition;
