/**
 * Resolves a filename for a given storage ID.
 * If a filename is provided, returns it directly.
 * Otherwise, looks up the filename from the fileMetadata table.
 */

import type { ActionCtx } from '../../../_generated/server';

import { internal } from '../../../_generated/api';
import { toId } from '../../../lib/type_cast_helpers';

export async function resolveFileName(
  ctx: ActionCtx,
  fileId: string,
  providedFilename?: string,
): Promise<string> {
  if (providedFilename) {
    return providedFilename;
  }

  const metadata = await ctx.runQuery(
    internal.file_metadata.internal_queries.getByStorageId,
    { storageId: toId<'_storage'>(fileId) },
  );

  if (!metadata) {
    throw new Error(
      `Could not resolve filename for fileId '${fileId}'. No fileMetadata record found. Please provide filename explicitly.`,
    );
  }

  return metadata.fileName;
}
