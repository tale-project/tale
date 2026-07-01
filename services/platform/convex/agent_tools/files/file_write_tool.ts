/**
 * file_write — create or replace a file in the current thread's workspace.
 *
 * Part of the new thread-workspace primitive (`threadFiles` table). The
 * LLM writes one file at a time; existing files at the same path are
 * replaced atomically. The path is validated by
 * `_shared.ts:validatePath`; quotas (file size, workspace bytes, file
 * count) are enforced by `thread_files/internal_mutations.ts`.
 *
 * Pair with `run_code` to execute the file in the sandbox — the sandbox
 * mount mirrors the workspace state at run time, so `file_write` then
 * `run_code({entryPath})` is the canonical flow.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import type { ToolDefinition } from '../types';
import { InvalidFilePathError, inferContentType } from './_shared';
import { parseWorkspacePath } from './sandbox_paths';

const RENDER_HINTS = [
  'html',
  'svg',
  'mermaid',
  'markdown',
  'code',
  'image',
  'attachment',
] as const;

const fileWriteArgs = z.object({
  path: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'Absolute path under `/user/code/`, e.g. `/user/code/gen.py` — the workspace code dir (also the `run_code` cwd). Deliverables are produced by `run_code` into `/user/output/`, not here.',
    ),
  content: z
    .string()
    .max(10 * 1024 * 1024)
    .describe(
      'UTF-8 file contents. For binary files, use base64 + set `encoding: "base64"`.',
    ),
  encoding: z
    .enum(['utf8', 'base64'])
    .optional()
    .describe(
      'Encoding of `content`. Default "utf8". Use "base64" for binary payloads (images, archives).',
    ),
  renderHint: z
    .enum(RENDER_HINTS)
    .optional()
    .describe(
      'Override the canvas renderer. Defaults to extension-based inference (`.html` → iframe, `.md` → markdown, `.py` → code, ...). Use this only when the extension is ambiguous.',
    ),
});

type FileWriteArgs = z.infer<typeof fileWriteArgs>;

export const fileWriteTool: ToolDefinition = {
  name: 'file_write' as const,
  tool: createTool({
    description: `**file_write** — create or replace a file in the current thread's workspace.

Writes one file at a time. If a file already exists at \`path\` it is replaced atomically; otherwise a new entry is created.

USE THIS TO:
- Stage code you're about to execute (\`file_write({path: "gen.py", ...})\` then \`run_code({entryPath: "gen.py"})\`)
- Save generated content the user should be able to download (\`landing.html\`, \`report.md\`, etc.)
- Materialize intermediate data the next \`run_code\` call should read

SANDBOX OUTPUT: a file you write here is staged at \`/user/code/<path>\` — the \`run_code\` cwd. Any **deliverable** your script then produces (an \`.xlsx\`, \`.pdf\`, chart image, …) must be written to \`/user/output/\` — the ONLY directory \`run_code\` harvests back into the thread. Files left in the cwd, \`/user/code/\`, or \`/tmp\` are discarded when the container exits. If a skill's example saves to a bare relative path like \`output.xlsx\`, rewrite it as \`/user/output/output.xlsx\`.

QUOTAS:
- ≤ 10 MB per file
- ≤ 100 files per workspace
- ≤ 100 MB per workspace (aggregate)

The canvas (right pane) renders workspace files by extension automatically — \`.html\` opens in a sandboxed iframe, \`.svg\` renders inline, \`.md\` as markdown, \`.py\`/\`.ts\`/\`.json\` as syntax-highlighted code, image extensions inline, others as a download chip.`,
    inputSchema: fileWriteArgs,
    execute: async (ctx: ToolCtx, args: FileWriteArgs) => {
      const { organizationId, threadId } = ctx;
      if (!organizationId || !threadId) {
        return {
          ok: false as const,
          code: 'NO_THREAD_CONTEXT' as const,
          message:
            'file_write requires a thread context (organizationId + threadId).',
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
      // file_write authors workspace files → `/user/code` (agent_write). It
      // does not write user uploads or run_code outputs.
      if (parsed === null || parsed.source !== 'agent_write') {
        return {
          ok: false as const,
          code: 'INVALID_PATH' as const,
          reason: 'path_wrong_root' as const,
          message: `file_write writes under /user/code/ only (e.g. /user/code/gen.py). /user/output/ is produced by run_code; /user/uploads/ holds user files.`,
        };
      }
      const normalizedPath = parsed.path;
      const encoding = args.encoding ?? 'utf8';
      let bytes: Uint8Array;
      try {
        if (encoding === 'base64') {
          bytes = Uint8Array.from(Buffer.from(args.content, 'base64'));
        } else {
          bytes = new TextEncoder().encode(args.content);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          ok: false as const,
          code: 'DECODE_ERROR' as const,
          message: `Failed to decode content as ${encoding}: ${msg}`,
        };
      }
      const contentType = inferContentType(normalizedPath);
      // Copy bytes into a fresh ArrayBuffer so the Blob constructor's
      // BlobPart constraint accepts it (Uint8Array<ArrayBufferLike> includes
      // SharedArrayBuffer in TS's strict lib and is rejected).
      const ab = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(ab).set(bytes);
      const blob = new Blob([ab], { type: contentType });

      let storageId: string;
      try {
        storageId = await ctx.storage.store(blob);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          ok: false as const,
          code: 'STORAGE_ERROR' as const,
          message: `Failed to store file bytes: ${msg}`,
        };
      }

      try {
        const result = await ctx.runMutation(
          internal.thread_files.internal_mutations.upsertThreadFile,
          {
            organizationId,
            threadId,
            path: normalizedPath,
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ctx.storage.store returns a branded Id<'_storage'> string at runtime
            storageId: storageId as never,
            size: blob.size,
            contentType,
            source: 'agent_write' as const,
            ...(args.renderHint !== undefined && {
              renderHint: args.renderHint,
            }),
          },
        );
        return {
          ok: true as const,
          path: normalizedPath,
          size: blob.size,
          contentType,
          replaced: result.replaced,
        };
      } catch (err) {
        // ConvexError from the mutation carries .data { code, ... } for
        // quota failures — surface that to the LLM so it can decide
        // whether to delete + retry, shrink, or stop.
        const data =
          err instanceof Error && 'data' in err
            ? (err as { data?: unknown }).data
            : undefined;
        if (
          data &&
          typeof data === 'object' &&
          'code' in data &&
          (data as { code: unknown }).code === 'WORKSPACE_QUOTA'
        ) {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shape-narrowed by the conditional above
          const quota = data as {
            code: 'WORKSPACE_QUOTA';
            scope: 'file' | 'workspace_bytes' | 'workspace_files';
            limit: number;
            size?: number;
            current?: number;
            message: string;
          };
          // Free the orphan storage blob we just created — the mutation
          // rejected before it got upserted, so the storage row would
          // leak otherwise.
          try {
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ctx.storage.store returned this id moments ago
            await ctx.storage.delete(storageId as never);
          } catch (delErr) {
            console.warn('[file_write] orphan storage cleanup failed:', delErr);
          }
          return {
            ok: false as const,
            code: quota.code,
            scope: quota.scope,
            limit: quota.limit,
            ...(quota.size !== undefined && { size: quota.size }),
            ...(quota.current !== undefined && { current: quota.current }),
            message: quota.message,
          };
        }
        try {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ctx.storage.store returned this id moments ago
          await ctx.storage.delete(storageId as never);
        } catch (delErr) {
          console.warn('[file_write] orphan storage cleanup failed:', delErr);
        }
        throw err;
      }
    },
  }),
};
