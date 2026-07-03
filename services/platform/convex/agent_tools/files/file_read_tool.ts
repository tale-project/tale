/**
 * file_read — read a file from the current thread's workspace.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import type { ToolDefinition } from '../types';
import { InvalidFilePathError } from './_shared';
import { parseWorkspacePath } from './sandbox_paths';

const MAX_INLINE_BYTES = 1024 * 1024; // 1 MB inline reply cap

const fileReadArgs = z.object({
  path: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'Absolute workspace path, e.g. `/user/output/report.pptx`, `/user/uploads/data.csv`, or `/user/code/gen.py` — the same path `run_code` uses.',
    ),
  encoding: z
    .enum(['utf8', 'base64'])
    .optional()
    .describe(
      'Encoding for the returned content. Default "utf8". Use "base64" for binary files (images, archives).',
    ),
});

type FileReadArgs = z.infer<typeof fileReadArgs>;

export const fileReadTool: ToolDefinition = {
  name: 'file_read' as const,
  availability: 'any' as const,
  tool: createTool({
    description: `**file_read** — read a file from the current thread's workspace.

Returns the file's content (UTF-8 by default; pass \`encoding: "base64"\` for binary). For files larger than 1 MB the tool returns metadata only — use the canvas (right pane) to inspect large files instead.`,
    inputSchema: fileReadArgs,
    execute: async (ctx: ToolCtx, args: FileReadArgs) => {
      const { organizationId, threadId } = ctx;
      if (!organizationId || !threadId) {
        return {
          ok: false as const,
          code: 'NO_THREAD_CONTEXT' as const,
          message:
            'file_read requires a thread context (organizationId + threadId).',
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
          message: `Path "${args.path}" must be an absolute workspace path under /user/uploads, /user/code, or /user/output.`,
        };
      }

      const row = await ctx.runQuery(
        internal.thread_files.internal_queries.getThreadFileByPath,
        { threadId, path: parsed.path },
      );
      if (row === null) {
        return {
          ok: false as const,
          code: 'NOT_FOUND' as const,
          message: `No workspace file at "${args.path}".`,
        };
      }
      if (row.organizationId !== organizationId) {
        return {
          ok: false as const,
          code: 'CROSS_ORG_ACCESS' as const,
          message: 'File does not belong to this organization.',
        };
      }

      if (row.size > MAX_INLINE_BYTES) {
        return {
          ok: true as const,
          path: row.path,
          size: row.size,
          contentType: row.contentType,
          content: '',
          encoding: 'utf8' as const,
          truncated: true,
          message: `File is ${row.size} bytes — too large to inline (limit ${MAX_INLINE_BYTES}). The canvas can display it.`,
        };
      }

      const blob = await ctx.storage.get(row.storageId);
      if (blob === null) {
        return {
          ok: false as const,
          code: 'STORAGE_MISSING' as const,
          message: `Workspace file row exists but its storage blob is missing (storageId=${row.storageId}).`,
        };
      }
      const buf = Buffer.from(await blob.arrayBuffer());
      const encoding = args.encoding ?? 'utf8';
      const content =
        encoding === 'base64' ? buf.toString('base64') : buf.toString('utf8');
      return {
        ok: true as const,
        path: row.path,
        size: row.size,
        contentType: row.contentType,
        content,
        encoding,
        truncated: false,
      };
    },
  }),
};
