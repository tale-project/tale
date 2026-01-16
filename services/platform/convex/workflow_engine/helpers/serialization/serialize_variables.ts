/**
 * Serialize variables helpers
 *
 * - In actions: can upload to Convex storage (store + get + getUrl)
 * - In mutations: can only inline JSON or delete existing storage
 */

import type { ActionCtx } from '../../../_generated/server';
import type { Id } from '../../../_generated/dataModel';

import { createDebugLog } from '../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_WORKFLOW', '[Workflow]');

// Threshold: 800KB (safe margin under 1MB limit)
export const SIZE_THRESHOLD = 800 * 1024;

export interface SerializeResult {
  serialized: string;
  storageId?: Id<'_storage'>;
}

/**
 * Action-safe serializer: stores large payloads in Convex storage and returns a reference.
 */
export async function serializeVariables(
  ctx: ActionCtx,
  variables: Record<string, unknown> | undefined | null,
  oldStorageId?: Id<'_storage'>,
): Promise<SerializeResult> {
  const json = JSON.stringify(variables ?? {});
  const sizeInBytes = new Blob([json]).size;

  const mustUseStorage = !!oldStorageId; // sticky once in storage
  const shouldUseStorage = mustUseStorage || sizeInBytes >= SIZE_THRESHOLD;

  debugLog('serializeVariables Variable size:', {
    sizeInBytes,
    threshold: SIZE_THRESHOLD,
    mustUseStorage,
    willUseStorage: shouldUseStorage,
  });

  if (!shouldUseStorage) {
    // Inline JSON. No deletes here to avoid races.
    return { serialized: json };
  }

  // Always store to storage (Convex storage is immutable).
  // Do NOT delete the old storage file here; the mutation will delete it after DB patch.
  const blob = new Blob([json], { type: 'application/json' });
  const storageId = await ctx.storage.store(blob);

  return {
    serialized: JSON.stringify({ _storageRef: storageId }),
    storageId,
  };
}
