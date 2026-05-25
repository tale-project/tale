/**
 * file_delete — remove a file from the current thread's workspace.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import type { ToolDefinition } from '../types';
import { InvalidFilePathError, validatePath } from './_shared';

const fileDeleteArgs = z.object({
  path: z
    .string()
    .min(1)
    .max(200)
    .describe('Workspace-relative path of the file to delete.'),
});

type FileDeleteArgs = z.infer<typeof fileDeleteArgs>;

export const fileDeleteTool: ToolDefinition = {
  name: 'file_delete' as const,
  tool: createTool({
    description: `**file_delete** — remove a file from the current thread's workspace.

Idempotent: deleting a path that doesn't exist returns \`ok: true\` with \`deleted: false\`. Use to free workspace quota or clean up intermediate files before the user sees the canvas.`,
    inputSchema: fileDeleteArgs,
    execute: async (ctx: ToolCtx, args: FileDeleteArgs) => {
      const { organizationId, threadId } = ctx;
      if (!organizationId || !threadId) {
        return {
          ok: false as const,
          code: 'NO_THREAD_CONTEXT' as const,
          message:
            'file_delete requires a thread context (organizationId + threadId).',
        };
      }
      let normalizedPath: string;
      try {
        normalizedPath = validatePath(args.path);
      } catch (err) {
        if (err instanceof InvalidFilePathError) {
          return {
            ok: false as const,
            code: 'INVALID_PATH' as const,
            reason: err.code,
            message: err.message,
          };
        }
        throw err;
      }
      const result = await ctx.runMutation(
        internal.thread_files.internal_mutations.deleteThreadFile,
        {
          organizationId,
          threadId,
          path: normalizedPath,
        },
      );
      return {
        ok: true as const,
        path: normalizedPath,
        deleted: result.deleted,
      };
    },
  }),
};
