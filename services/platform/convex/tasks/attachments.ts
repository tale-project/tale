import { ConvexError, type Infer } from 'convex/values';

import {
  TASK_MAX_ATTACHMENTS,
  TASK_UPLOAD_ALLOWED_TYPES,
} from '../../lib/shared/file-types';
import { isTextBasedFile } from '../../lib/utils/text-file-types';
import type { MutationCtx } from '../_generated/server';
import { deleteStorageWithMetadata } from '../file_metadata/helpers';
import type { taskAttachmentValidator } from './schema';

export type TaskAttachmentInput = Infer<typeof taskAttachmentValidator>;

/**
 * Validate the attachment set a create/update carries. Full-replace semantics
 * (the client always sends the whole desired list, like `labels`). Enforces the
 * count cap and the images-or-documents MIME allow-list, de-dupes by storage
 * id, and — defense-in-depth against a forged `_storage` id pointing at another
 * org's blob — confirms each file has a `fileMetadata` row in THIS org. Returns
 * `undefined` for an empty result so the field is dropped rather than stored as
 * `[]`. `undefined` input means "not touched by this write" (left as-is).
 */
export async function validateTaskAttachments(
  ctx: MutationCtx,
  organizationId: string,
  attachments: TaskAttachmentInput[] | undefined,
): Promise<TaskAttachmentInput[] | undefined> {
  if (attachments == null) return undefined;
  if (attachments.length > TASK_MAX_ATTACHMENTS) {
    throw new ConvexError({ code: 'TASK_ATTACHMENTS_TOO_MANY' });
  }
  const seen = new Set<string>();
  const result: TaskAttachmentInput[] = [];
  for (const att of attachments) {
    if (seen.has(att.fileId)) continue;
    seen.add(att.fileId);
    // Text-based files pass alongside the MIME allowlist — the same gate the
    // conversations lane and the client upload hook use. The picker's shared
    // accept string offers md/json/yaml/py; rejecting them HERE (after the
    // blob upload) stranded an orphaned, already-indexed blob behind a
    // generic error.
    if (
      !TASK_UPLOAD_ALLOWED_TYPES.includes(att.fileType) &&
      !isTextBasedFile(att.fileName, att.fileType)
    ) {
      throw new ConvexError({ code: 'TASK_ATTACHMENT_TYPE_INVALID' });
    }
    const meta = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', att.fileId))
      .first();
    if (!meta || meta.organizationId !== organizationId) {
      throw new ConvexError({ code: 'TASK_ATTACHMENT_NOT_FOUND' });
    }
    result.push({
      fileId: att.fileId,
      fileName: att.fileName.slice(0, 255),
      fileType: att.fileType,
      fileSize: att.fileSize,
    });
  }
  return result.length > 0 ? result : undefined;
}

/**
 * Delete the storage blobs (and their `fileMetadata` rows) for attachments that
 * were present on `previous` but dropped from `next`. Task attachments aren't
 * thread-bound, so nothing else cleans them up — a removed image must be purged
 * here or it orphans in storage. Idempotent: `deleteStorageWithMetadata` no-ops
 * if the blob/row is already gone.
 */
export async function cleanupRemovedAttachments(
  ctx: MutationCtx,
  previous: TaskAttachmentInput[] | undefined,
  next: TaskAttachmentInput[] | undefined,
): Promise<void> {
  if (!previous?.length) return;
  const keptIds = new Set((next ?? []).map((a) => a.fileId));
  for (const att of previous) {
    if (!keptIds.has(att.fileId)) {
      await deleteStorageWithMetadata(ctx, att.fileId);
    }
  }
}
