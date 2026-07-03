/**
 * file_delete — remove a file from the current thread's workspace.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import type { ToolDefinition } from '../types';
import { InvalidFilePathError } from './_shared';
import { parseWorkspacePath } from './sandbox_paths';

const fileDeleteArgs = z.object({
  path: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'Absolute workspace path to delete, e.g. `/user/output/old.pptx` or `/user/code/tmp.py`.',
    ),
});

type FileDeleteArgs = z.infer<typeof fileDeleteArgs>;

export const fileDeleteTool: ToolDefinition = {
  name: 'file_delete' as const,
  availability: 'any' as const,
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
      let parsed;
      try {
        parsed = parseWorkspacePath(args.path);
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
      if (parsed === null) {
        return {
          ok: false as const,
          code: 'INVALID_PATH' as const,
          reason: 'path_invalid_root' as const,
          message: `Path "${args.path}" must be an absolute workspace path under /user/{uploads,code,output}/.`,
        };
      }
      const normalizedPath = parsed.path;
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
