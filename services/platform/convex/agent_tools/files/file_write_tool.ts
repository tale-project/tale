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
import { getWorkspaceThreadId } from '../../threads/get_parent_thread_id';
import type { ToolDefinition } from '../types';
import { InvalidFilePathError, inferContentType, sha256Hex } from './_shared';
import { buildSandboxState } from './helpers/sandbox_state';
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
      "Absolute path under `/user/code/` (scripts + working files, e.g. `/user/code/gen.py` — the `run_code` cwd) or `/user/output/` (final deliverables, e.g. `/user/output/report.md`). `/user/uploads/` is the user's — read-only.",
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
  availability: 'any' as const,
  tool: createTool({
    description: `**file_write** — create or atomically replace one workspace file per call.

USE FOR: final deliverables → \`/user/output/report.md\` (write directly; no script detour); code to execute → \`file_write\` then \`run_code({entryPath: "/user/code/gen.py"})\` (\`/user/code/\` is the only executable location); intermediate data for a later \`run_code\`.

Inside a \`run_code\` script the same rule applies: deliverables must be saved to \`/user/output/\` — files left in the cwd or \`/tmp\` are discarded when the container exits. Rewrite a skill example's bare \`output.xlsx\` as \`/user/output/output.xlsx\`.

QUOTAS: ≤ 10 MB per file; ≤ 100 files and ≤ 100 MB per workspace.

Every result includes \`sandboxState\` — the current workspace manifest. Trust it over memory: a file listed there already exists, don't recreate it.

The canvas renders workspace files by extension (\`.html\` sandboxed iframe, \`.svg\` inline, \`.md\` markdown, code highlighted, images inline, others a download chip).`,
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
      // The workspace belongs to the parent chat thread — a spawned worker
      // (job sub-thread) writes into the SAME workspace the parent agent and
      // the user's canvas read, so its files are visible after the job ends.
      const workspaceThreadId = await getWorkspaceThreadId(ctx, threadId);
      const outcome = await (async () => {
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
        // file_write authors scripts (/user/code) and deliverables
        // (/user/output). /user/uploads is the user's — read-only.
        if (parsed === null || parsed.source === 'user_upload') {
          return {
            ok: false as const,
            code: 'INVALID_PATH' as const,
            reason: 'path_wrong_root' as const,
            message: `file_write writes under /user/code/ (scripts) or /user/output/ (deliverables). /user/uploads/ holds the user's files and is read-only.`,
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
        // Copy bytes into a fresh ArrayBuffer (exact-size, detached from any
        // SharedArrayBuffer typing) for the cross-action `v.bytes()` arg.
        const ab = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(ab).set(bytes);

        let storageId: string;
        try {
          // Backend-aware store via the node lane: the org's own bucket when
          // configured, else Convex `_storage`. This tool is bundled into the
          // V8 workflow engine, so it cannot import the 'use node' seam
          // directly — it hops through the internal action instead.
          storageId = await ctx.runAction(
            internal.files.blob_actions.storeOrgBlob,
            { organizationId, bytes: ab, contentType },
          );
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
              threadId: workspaceThreadId,
              path: normalizedPath,
              // Blob reference string — upsertThreadFile is blobRef-wide.
              storageId,
              size: bytes.byteLength,
              contentType,
              sha256: await sha256Hex(bytes),
              // Provenance is the WRITER (the model), whichever root the
              // file lands in — /user/output holds agent_write deliverables
              // alongside run_output harvests.
              source: 'agent_write' as const,
              ...(args.renderHint !== undefined && {
                renderHint: args.renderHint,
              }),
            },
          );
          return {
            ok: true as const,
            path: normalizedPath,
            size: bytes.byteLength,
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
              // Backend-aware orphan reclaim via the node delete lane
              // (idempotent, handles `_storage` ids AND `s3:` refs).
              await ctx.runAction(internal.files.blob_actions.deleteOrgBlobs, {
                organizationId,
                refs: [storageId],
              });
            } catch (delErr) {
              console.warn(
                '[file_write] orphan storage cleanup failed:',
                delErr,
              );
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
            // Backend-aware orphan reclaim via the node delete lane.
            await ctx.runAction(internal.files.blob_actions.deleteOrgBlobs, {
              organizationId,
              refs: [storageId],
            });
          } catch (delErr) {
            console.warn('[file_write] orphan storage cleanup failed:', delErr);
          }
          throw err;
        }
      })();
      // Attach the workspace ground truth to every outcome (success or
      // failure) so the model never acts on a stale view of the sandbox.
      return {
        ...outcome,
        sandboxState: await buildSandboxState(ctx, {
          organizationId,
          workspaceThreadId,
        }),
      };
    },
  }),
};
