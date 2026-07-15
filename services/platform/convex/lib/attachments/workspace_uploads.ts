'use node';

/**
 * File chat attachments into the thread workspace (`threadFiles`) as
 * `source: 'user_upload'` rows at `/user/uploads/<name>` — the area the
 * file_read / file_list / run_code descriptions promise. Before this writer
 * existed the area stayed empty forever: attachments lived only in storage +
 * fileMetadata + message parts, so workspace tools could never see them.
 *
 * Bytes are COPIED to a fresh blob reference per row (house rule — see
 * `threads/snapshot_thread_files.ts`): `upsertThreadFile` deletes the previous
 * blob on replace and `file_delete` deletes it on remove, so the workspace
 * must own its blobs exclusively; the original attachment blob stays
 * referenced by the chat message parts and the agent-component file registry.
 * Both the read of the source attachment AND the copy go through the
 * backend-aware seam, so a BYO-bucket org's workspace copies land in its own
 * bucket (`'use node'` — S3 signing needs the node runtime; the sole importer
 * is the node `runAgentGeneration` action).
 *
 * Fail-open per file: a quota rejection or storage hiccup logs and skips —
 * the attachment is still usable via the pre-analyzed prompt content and the
 * image tool, exactly as before — and never breaks the chat turn.
 */

import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import { sha256Hex } from '../../agent_tools/files/_shared';
import {
  MAX_ATTACHMENTS_PER_TURN,
  dedupeName,
  sanitizeAttachmentName,
} from '../../agents/external_agent/attachment_files';
import { THREAD_FILE_MAX_BYTES } from '../../thread_files/schema';
import { orgSlugFromIdOrNull } from '../helpers/org_slug';
import { deleteBlob, putBlob, readBlobBytes } from '../storage/blob_access';
import { convexStorageId, type BlobRef } from '../storage/blob_ref';
import type { FileAttachment } from './types';

const UPLOADS_PATH_PREFIX = '/user/uploads';

export interface WorkspaceUploadPlan {
  planned: Array<{ attachment: FileAttachment; path: string }>;
  skipped: Array<{ name: string; reason: 'too_large' | 'too_many' }>;
}

/**
 * Decide where each attachment lands (pure, testable): sanitized basename
 * under `/user/uploads/`, de-duped within the batch (`a.png`, `a-2.png`),
 * capped per file (workspace per-file byte cap) and per turn. A same-named
 * file from an EARLIER message is replaced by the upsert — newest wins,
 * matching file_write semantics.
 */
export function buildWorkspaceUploadPlan(
  attachments: readonly FileAttachment[],
): WorkspaceUploadPlan {
  const planned: WorkspaceUploadPlan['planned'] = [];
  const skipped: WorkspaceUploadPlan['skipped'] = [];
  const used = new Set<string>();
  attachments.forEach((attachment, i) => {
    if (i >= MAX_ATTACHMENTS_PER_TURN) {
      skipped.push({ name: attachment.fileName, reason: 'too_many' });
      return;
    }
    if (attachment.fileSize > THREAD_FILE_MAX_BYTES) {
      skipped.push({ name: attachment.fileName, reason: 'too_large' });
      return;
    }
    const diskName = dedupeName(
      sanitizeAttachmentName(attachment.fileName),
      used,
    );
    planned.push({ attachment, path: `${UPLOADS_PATH_PREFIX}/${diskName}` });
  });
  return { planned, skipped };
}

/**
 * Copy each planned attachment into the workspace thread. Call it with the
 * WORKSPACE thread id (resolve sub-threads via `getWorkspaceThreadId` first)
 * before generation starts, so the model's first `file_list` already sees the
 * uploads. Returns counts for the caller's debug log.
 */
export async function fileAttachmentsIntoWorkspace(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    workspaceThreadId: string;
    attachments: readonly FileAttachment[];
  },
): Promise<{ filed: number; unchanged: number; skipped: number }> {
  const { planned, skipped } = buildWorkspaceUploadPlan(args.attachments);
  for (const s of skipped) {
    console.warn(
      `[workspace_uploads] not filing "${s.name}" into /user/uploads: ${s.reason}`,
    );
  }
  let filed = 0;
  let unchanged = 0;
  let failed = 0;
  // Slug for the backend-aware read/copy. Unresolvable → Convex `_storage`
  // fallback (never break the turn over blob routing).
  const orgSlug =
    planned.length > 0
      ? await orgSlugFromIdOrNull(ctx, args.organizationId)
      : null;
  await Promise.all(
    planned.map(async ({ attachment, path }) => {
      try {
        let bytes: Uint8Array;
        const convexId = convexStorageId(attachment.fileId);
        if (convexId !== null) {
          const blob = await ctx.storage.get(convexId);
          if (blob === null) {
            failed += 1;
            console.warn(
              `[workspace_uploads] attachment blob missing for ${path} (${attachment.fileId})`,
            );
            return;
          }
          bytes = new Uint8Array(await blob.arrayBuffer());
        } else {
          if (orgSlug === null) {
            failed += 1;
            console.warn(
              `[workspace_uploads] org unresolvable; cannot read S3 attachment for ${path}`,
            );
            return;
          }
          bytes = await readBlobBytes(ctx, orgSlug, attachment.fileId);
        }
        const sha256 = await sha256Hex(bytes);
        const contentType =
          attachment.fileType.trim().length > 0
            ? attachment.fileType
            : 'application/octet-stream';
        // Re-send of unchanged bytes (regenerate, duplicate upload): skip
        // before copying so no orphan blob is ever stored.
        const existing = await ctx.runQuery(
          internal.thread_files.internal_queries.getThreadFileByPath,
          { threadId: args.workspaceThreadId, path },
        );
        if (
          existing !== null &&
          existing.sha256 === sha256 &&
          existing.source === 'user_upload'
        ) {
          unchanged += 1;
          return;
        }
        // Backend-aware copy: the org's own bucket when configured, else
        // Convex `_storage` (putBlob routes; a null slug forces `_storage`).
        let copyId: BlobRef;
        if (orgSlug !== null) {
          copyId = await putBlob(ctx, orgSlug, bytes, contentType);
        } else {
          const ab = new ArrayBuffer(bytes.byteLength);
          new Uint8Array(ab).set(bytes);
          copyId = await ctx.storage.store(
            new Blob([ab], { type: contentType }),
          );
        }
        try {
          await ctx.runMutation(
            internal.thread_files.internal_mutations.upsertThreadFile,
            {
              organizationId: args.organizationId,
              threadId: args.workspaceThreadId,
              path,
              storageId: copyId,
              size: bytes.byteLength,
              contentType,
              sha256,
              source: 'user_upload' as const,
              // Only images carry a hint. Anything else stays unhinted so the
              // viewer's inference decides — stamping 'attachment' here made
              // every non-image upload permanently download-only, unlike the
              // agent-written twin of the same file (#2677).
              ...(contentType.startsWith('image/')
                ? { renderHint: 'image' as const }
                : {}),
            },
          );
          filed += 1;
        } catch (err) {
          // Quota/validation rejection — reap the now-orphaned copy blob.
          try {
            const copyConvexId = convexStorageId(copyId);
            if (copyConvexId !== null) {
              await ctx.storage.delete(copyConvexId);
            } else if (orgSlug !== null) {
              await deleteBlob(ctx, orgSlug, copyId);
            }
          } catch (delErr) {
            console.warn(
              '[workspace_uploads] orphan copy cleanup failed:',
              delErr,
            );
          }
          throw err;
        }
      } catch (err) {
        failed += 1;
        console.warn(
          `[workspace_uploads] filing ${path} failed (attachment still readable via chat):`,
          err,
        );
      }
    }),
  );
  return { filed, unchanged, skipped: skipped.length + failed };
}
