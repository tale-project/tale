/**
 * Convex Tool: file_rename
 *
 * Rename one file in an artifact's project tree. If `from === entryFile`,
 * the entry pointer atomically moves to `to`.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import type { ToolExecutionOptions } from 'ai';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { toId } from '../../lib/type_cast_helpers';
import type { ToolDefinition } from '../types';

const fileRenameArgs = z.object({
  artifactId: z.string().min(1),
  from: z.string().min(1).max(200).describe('Existing file path to rename.'),
  to: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'New file path. Must not already exist — call `file_delete` first if you intend to replace.',
    ),
  expectedRevision: z
    .number()
    .int()
    .nonnegative()
    .describe(
      'REQUIRED: revision the rename was authored against. OCC — rejects with `code: "stale"` and `currentRevision` if the artifact has moved.',
    ),
});

type FileRenameInput = z.infer<typeof fileRenameArgs>;

interface FileRenameSuccess {
  success: true;
  artifactId: string;
  revision: number;
  from: string;
  to: string;
  entryFile: string;
  entryUpdated: boolean;
  message: string;
}

interface FileRenameFailure {
  success: false;
  code?: string;
  message: string;
  currentRevision?: number;
}

type FileRenameResult = FileRenameSuccess | FileRenameFailure;

export const fileRenameTool = {
  name: 'file_rename' as const,
  tool: createTool({
    description: `**file_rename** — rename one file inside an artifact. If \`from === entryFile\`, the entry pointer atomically moves to \`to\`.

**INPUTS:** \`artifactId\`, \`from\`, \`to\`, \`expectedRevision\`.

**RULES:**
- \`from === to\` is a no-op success (idempotent).
- \`to\` must not already exist (code: \`path_exists\`).
- \`from\` must exist (code: \`file_missing\`).

**RESPONSE:** \`{revision, from, to, entryFile, entryUpdated, message}\`. \`entryUpdated\` is true iff the entry pointer moved with the rename. Errors carry \`code\` (\`not_found\`, \`stale\`, \`file_missing\`, \`path_exists\`).`,
    inputSchema: fileRenameArgs,
    execute: async (
      ctx: ToolCtx,
      args: FileRenameInput,
      _options: ToolExecutionOptions,
    ): Promise<FileRenameResult> => {
      const { organizationId, threadId, messageId } = ctx;
      if (!organizationId || !threadId) {
        return {
          success: false,
          message:
            'file_rename requires organizationId and threadId in the tool context.',
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
      const artifact = await ctx.runQuery(
        internal.artifacts.internal_queries.getById,
        {
          artifactId,
          expectedOrganizationId: organizationId,
          expectedThreadId: threadId,
        },
      );
      if (!artifact) {
        return {
          success: false,
          code: 'not_found',
          message: `Artifact ${args.artifactId} not found in this thread.`,
        };
      }
      const result = await ctx.runMutation(
        internal.artifacts.internal_mutations.renameFileInArtifact,
        {
          artifactId,
          from: args.from,
          to: args.to,
          editedByMessageId: messageId ?? '',
          expectedRevision: args.expectedRevision,
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
        from: result.from,
        to: result.to,
        entryFile: result.entryFile,
        entryUpdated: result.entryUpdated,
        message: `Renamed "${result.from}" → "${result.to}" in "${artifact.title}". New revision: ${result.revision}.${entryNote}`,
      };
    },
  }),
} as const satisfies ToolDefinition;
