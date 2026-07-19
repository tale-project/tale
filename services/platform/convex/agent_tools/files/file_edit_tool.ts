/**
 * file_edit — apply a search-replace edit to an existing workspace file.
 *
 * Companion to `file_write`. Where `file_write` atomically replaces a
 * whole file (the LLM emits the full new contents), `file_edit` lets the
 * LLM make a targeted change — replace `old_string` with `new_string` —
 * without re-emitting the rest of the file. Saves tokens and is the
 * natural shape for iterative code editing.
 *
 * Mirrors Claude Code's `Edit` tool: requires the file to already exist,
 * requires `old_string` to occur exactly once unless `replace_all` is set.
 * Goes through the same `upsertThreadFile` mutation that `file_write`
 * uses, so quota / atomic blob-replacement semantics are identical.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { fetchBlobArrayBuffer } from '../../lib/storage/blob_read_any';
import { getWorkspaceThreadId } from '../../threads/get_parent_thread_id';
import type { ToolDefinition } from '../types';
import { InvalidFilePathError, inferContentType, sha256Hex } from './_shared';
import { buildSandboxState } from './helpers/sandbox_state';
import { parseWorkspacePath } from './sandbox_paths';

const fileEditArgs = z.object({
  path: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'Absolute path of the file to edit, under `/user/code/` (e.g. `/user/code/gen.py`) or `/user/output/` (e.g. `/user/output/report.md`). Must already exist.',
    ),
  old_string: z
    .string()
    .min(1)
    .describe(
      'Exact substring to find in the file. Include enough surrounding context to make it unique (or pass `replace_all: true`).',
    ),
  new_string: z
    .string()
    .describe(
      'Replacement text. May be empty to delete `old_string`. Whitespace and indentation are preserved literally.',
    ),
  replace_all: z
    .boolean()
    .optional()
    .describe(
      'When true, replace every occurrence of `old_string`. Default false — the tool errors with `OLD_STRING_NOT_UNIQUE` if the substring appears more than once.',
    ),
});

type FileEditArgs = z.infer<typeof fileEditArgs>;

const EDITABLE_CONTENT_TYPES = new Set<string>([
  'application/json',
  'application/json; charset=utf-8',
  'application/yaml',
  'application/yaml; charset=utf-8',
  'application/toml',
  'application/toml; charset=utf-8',
  'application/xml',
  'application/xml; charset=utf-8',
  'image/svg+xml',
]);

function isEditableContentType(contentType: string): boolean {
  if (contentType.startsWith('text/')) return true;
  return EDITABLE_CONTENT_TYPES.has(contentType);
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = 0;
  while (true) {
    const found = haystack.indexOf(needle, idx);
    if (found === -1) break;
    count += 1;
    idx = found + needle.length;
  }
  return count;
}

export const fileEditTool: ToolDefinition = {
  name: 'file_edit' as const,
  availability: 'any' as const,
  tool: createTool({
    description: `**file_edit** — targeted search-replace in an existing workspace file: replaces \`old_string\` with \`new_string\`. The match is **literal** (whitespace and indentation included) — no regex, no wildcards. \`old_string\` must occur exactly once (else \`OLD_STRING_NOT_UNIQUE\` — widen the context or set \`replace_all\`). The edit is atomic (same file identity, new blob).

USE THIS over \`file_write\` for small changes to a file you already wrote — the rest stays byte-identical; far cheaper than re-emitting it. Use \`file_write\` instead when the file does not exist yet (\`file_edit\` errors \`NOT_FOUND\`; only \`file_write\` creates files), when you're rewriting most of it anyway, or for binary files (\`file_edit\` only handles text).

QUOTAS: same workspace as \`file_write\` — ≤ 100 MB per file, ≤ 100 files and ≤ 1 GB per workspace.

Every result includes \`sandboxState\` — the current workspace manifest. Trust it over memory.`,
    inputSchema: fileEditArgs,
    execute: async (ctx: ToolCtx, args: FileEditArgs) => {
      const { organizationId, threadId } = ctx;
      if (!organizationId || !threadId) {
        return {
          ok: false as const,
          code: 'NO_THREAD_CONTEXT' as const,
          message:
            'file_edit requires a thread context (organizationId + threadId).',
        };
      }
      // Sub-thread runs (spawned jobs, delegates) share the parent chat
      // thread's workspace — resolve it before any lookup.
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
        // Same writable surface as file_write: scripts (/user/code) and
        // deliverables (/user/output). /user/uploads is read-only.
        if (parsed === null || parsed.source === 'user_upload') {
          return {
            ok: false as const,
            code: 'INVALID_PATH' as const,
            reason: 'path_wrong_root' as const,
            message: `file_edit edits files under /user/code/ or /user/output/. /user/uploads/ holds the user's files and is read-only.`,
          };
        }
        const normalizedPath = parsed.path;

        const row = await ctx.runQuery(
          internal.thread_files.internal_queries.getThreadFileByPath,
          { threadId: workspaceThreadId, path: normalizedPath },
        );
        if (row === null) {
          return {
            ok: false as const,
            code: 'NOT_FOUND' as const,
            message: `No workspace file at path "${normalizedPath}". Use file_write to create it first.`,
          };
        }
        if (row.organizationId !== organizationId) {
          return {
            ok: false as const,
            code: 'CROSS_ORG_ACCESS' as const,
            message: 'File does not belong to this organization.',
          };
        }

        if (!isEditableContentType(row.contentType)) {
          return {
            ok: false as const,
            code: 'BINARY_FILE' as const,
            contentType: row.contentType,
            message: `file_edit only supports text files (contentType=${row.contentType}). Use file_write to replace binary files.`,
          };
        }

        if (args.old_string === args.new_string) {
          return {
            ok: false as const,
            code: 'NO_CHANGE' as const,
            message: 'old_string and new_string are identical — nothing to do.',
          };
        }

        // Backend-aware read: `row.storageId` is a blob REFERENCE — an `s3:`
        // ref (BYO-bucket org) fetches through the presign lane; V8-safe.
        const read = await fetchBlobArrayBuffer(
          ctx,
          organizationId,
          row.storageId,
        );
        if (read === null) {
          return {
            ok: false as const,
            code: 'STORAGE_MISSING' as const,
            message: `Workspace file row exists but its storage blob is missing (storageId=${row.storageId}).`,
          };
        }

        let originalContent: string;
        try {
          const buf = Buffer.from(read.bytes);
          originalContent = buf.toString('utf8');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            ok: false as const,
            code: 'DECODE_ERROR' as const,
            message: `Failed to decode file as UTF-8: ${msg}`,
          };
        }

        const count = countOccurrences(originalContent, args.old_string);
        if (count === 0) {
          return {
            ok: false as const,
            code: 'OLD_STRING_NOT_FOUND' as const,
            message:
              'old_string was not found in the file. Check whitespace and indentation — the match is literal.',
          };
        }
        if (count > 1 && args.replace_all !== true) {
          return {
            ok: false as const,
            code: 'OLD_STRING_NOT_UNIQUE' as const,
            count,
            message: `old_string occurs ${count} times. Include more surrounding context to make it unique, or pass replace_all: true.`,
          };
        }

        let newContent: string;
        let replacements: number;
        if (args.replace_all === true) {
          newContent = originalContent
            .split(args.old_string)
            .join(args.new_string);
          replacements = count;
        } else {
          const idx = originalContent.indexOf(args.old_string);
          newContent =
            originalContent.slice(0, idx) +
            args.new_string +
            originalContent.slice(idx + args.old_string.length);
          replacements = 1;
        }

        const bytes = new TextEncoder().encode(newContent);
        const contentType = inferContentType(normalizedPath);
        // Copy bytes into a fresh ArrayBuffer (exact-size) for the
        // cross-action `v.bytes()` arg.
        const ab = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(ab).set(bytes);

        let storageId: string;
        try {
          // Backend-aware store via the node lane (this tool is bundled into
          // the V8 workflow engine — it cannot import the 'use node' seam).
          storageId = await ctx.runAction(
            internal.files.blob_actions.storeOrgBlob,
            { organizationId, bytes: ab, contentType },
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            ok: false as const,
            code: 'STORAGE_ERROR' as const,
            message: `Failed to store edited file bytes: ${msg}`,
          };
        }

        try {
          await ctx.runMutation(
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
              // file lands in.
              source: 'agent_write' as const,
            },
          );
          return {
            ok: true as const,
            path: normalizedPath,
            size: bytes.byteLength,
            contentType,
            replacements,
          };
        } catch (err) {
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
            try {
              // Backend-aware orphan reclaim via the node delete lane.
              await ctx.runAction(internal.files.blob_actions.deleteOrgBlobs, {
                organizationId,
                refs: [storageId],
              });
            } catch (delErr) {
              console.warn(
                '[file_edit] orphan storage cleanup failed:',
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
            console.warn('[file_edit] orphan storage cleanup failed:', delErr);
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
