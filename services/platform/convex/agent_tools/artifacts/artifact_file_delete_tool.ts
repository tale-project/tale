/**
 * Convex Tool: artifact_file_delete
 *
 * Remove one file from an artifact's project tree. Refused on the entry file
 * (rename the entry away first) and on the last remaining file in the
 * artifact (artifacts cannot be empty).
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import type { ToolExecutionOptions } from 'ai';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { toId } from '../../lib/type_cast_helpers';
import type { ToolDefinition } from '../types';

const fileDeleteArgs = z.object({
  artifactId: z.string().min(1),
  path: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'File path inside the artifact to delete. Refused on the entry file (call `artifact_file_rename` first to repoint the entry to another file) and on the last file in the artifact.',
    ),
  expectedRevision: z
    .number()
    .int()
    .nonnegative()
    .describe(
      'REQUIRED: revision the delete was authored against (from `<artifact revision="N">` or a prior `artifact_file_list` / `artifact_file_read`). OCC — rejects with `code: "stale"` and `currentRevision` if the artifact has moved.',
    ),
});

type FileDeleteInput = z.infer<typeof fileDeleteArgs>;

interface FileDeleteSuccess {
  success: true;
  artifactId: string;
  revision: number;
  path: string;
  message: string;
}

interface FileDeleteFailure {
  success: false;
  code?: string;
  message: string;
  currentRevision?: number;
  entryFile?: string;
}

type FileDeleteResult = FileDeleteSuccess | FileDeleteFailure;

export const artifactFileDeleteTool = {
  name: 'artifact_file_delete' as const,
  tool: createTool({
    description: `**artifact_file_delete** — remove one file from an artifact's project tree.

**INPUTS:** \`artifactId\`, \`path\`, \`expectedRevision\`.

**REFUSED ON:**
- the artifact's \`entryFile\` (code: \`entry_pin\`) — call \`artifact_file_rename\` first to repoint the entry to another file, or rename a sibling onto the entry path.
- the last file in the artifact (code: \`last_file\`) — artifacts cannot be empty.

**RESPONSE:** \`{revision, path, message}\` on success. Errors carry \`code\` (\`not_found\`, \`stale\`, \`file_missing\`, \`entry_pin\`, \`last_file\`) plus a recovery hint.`,
    inputSchema: fileDeleteArgs,
    execute: async (
      ctx: ToolCtx,
      args: FileDeleteInput,
      _options: ToolExecutionOptions,
    ): Promise<FileDeleteResult> => {
      const { organizationId, threadId, messageId } = ctx;
      if (!organizationId || !threadId) {
        return {
          success: false,
          message:
            'artifact_file_delete requires organizationId and threadId in the tool context.',
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
        internal.artifacts.internal_mutations.deleteFileFromArtifact,
        {
          artifactId,
          path: args.path,
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
    },
  }),
} as const satisfies ToolDefinition;
