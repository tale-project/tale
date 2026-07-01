/**
 * file_list — list files in the current thread's workspace.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import type { ToolDefinition } from '../types';

const fileListArgs = z.object({
  prefix: z
    .string()
    .max(200)
    .optional()
    .describe(
      'Optional absolute path prefix, e.g. `/user/output/` for run_code outputs, `/user/uploads/` for user uploads.',
    ),
});

type FileListArgs = z.infer<typeof fileListArgs>;

export const fileListTool: ToolDefinition = {
  name: 'file_list' as const,
  tool: createTool({
    description: `**file_list** — list every file currently in the thread's workspace, sorted newest first.

Use this to discover what files exist (user uploads, prior \`run_code\` outputs, your own writes) before reading or executing. Returns lightweight metadata (path, fileId, size, contentType, source, updatedAt). Use \`path\` with \`file_read\` / \`run_code\`; pass \`fileId\` to the \`image\` tool (analyze) or \`document_write\`. \`source\` (\`user_upload\` / \`agent_write\` / \`run_output\`) tells you which sandbox dir a file maps to.`,
    inputSchema: fileListArgs,
    execute: async (ctx: ToolCtx, args: FileListArgs) => {
      const { organizationId, threadId } = ctx;
      if (!organizationId || !threadId) {
        return {
          ok: false as const,
          code: 'NO_THREAD_CONTEXT' as const,
          message:
            'file_list requires a thread context (organizationId + threadId).',
        };
      }
      const prefix = args.prefix;
      // Stored paths are the canonical absolute `/user/<root>/…`, so an
      // absolute prefix filters directly.
      const rows = await ctx.runQuery(
        internal.thread_files.internal_queries.listThreadFiles,
        { threadId, ...(prefix !== undefined && { prefix }) },
      );
      const files = rows
        .filter(
          (r: { organizationId: string }) =>
            r.organizationId === organizationId,
        )
        .map(
          (r: {
            path: string;
            storageId: string;
            size: number;
            contentType: string;
            source: 'user_upload' | 'agent_write' | 'run_output';
            updatedAt: number;
          }) => ({
            path: r.path,
            // Storage id handoff token — pass as `fileId` to the `image` tool
            // (analyze) or `document_write`. `path` remains the identity for
            // file_read/file_write/file_delete; this changes on overwrite, so
            // use it now rather than caching it.
            fileId: r.storageId,
            size: r.size,
            contentType: r.contentType,
            source: r.source,
            updatedAt: r.updatedAt,
          }),
        );
      return {
        ok: true as const,
        count: files.length,
        files,
      };
    },
  }),
};
