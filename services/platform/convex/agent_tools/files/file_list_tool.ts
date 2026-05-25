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
      'Optional path prefix filter, e.g. `scripts/` returns only files under `scripts/`.',
    ),
});

type FileListArgs = z.infer<typeof fileListArgs>;

export const fileListTool: ToolDefinition = {
  name: 'file_list' as const,
  tool: createTool({
    description: `**file_list** — list every file currently in the thread's workspace, sorted newest first.

Use this to discover what files exist (user uploads, prior \`run_code\` outputs, your own writes) before reading or executing. Returns lightweight metadata only (path, size, contentType, source, updatedAt).`,
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
      const rows = await ctx.runQuery(
        internal.thread_files.internal_queries.listThreadFiles,
        {
          threadId,
          ...(args.prefix !== undefined && { prefix: args.prefix }),
        },
      );
      const filtered = rows.filter(
        (r: { organizationId: string }) => r.organizationId === organizationId,
      );
      return {
        ok: true as const,
        count: filtered.length,
        files: filtered.map(
          (r: {
            path: string;
            size: number;
            contentType: string;
            source: 'user_upload' | 'agent_write' | 'run_output';
            updatedAt: number;
          }) => ({
            path: r.path,
            size: r.size,
            contentType: r.contentType,
            source: r.source,
            updatedAt: r.updatedAt,
          }),
        ),
      };
    },
  }),
};
