/**
 * Serialize output helpers
 *
 * Similar to serialize_variables.ts but for workflow execution output.
 * - In actions: can upload to Convex storage (store + get + getUrl)
 * - In mutations: can only inline JSON or delete existing storage
 */

import type { ActionCtx } from '../../../_generated/server';
import type { Id } from '../../../_generated/dataModel';

import { createDebugLog } from '../../../lib/debug_log';
import { SIZE_THRESHOLD, SerializeResult } from './serialize_variables';

const debugLog = createDebugLog('DEBUG_WORKFLOW', '[Workflow]');

/**
 * Action-safe serializer: stores large output in Convex storage and returns a reference.
 */
export async function serializeOutput(
  ctx: ActionCtx,
  output: unknown,
  oldStorageId?: Id<'_storage'>,
): Promise<SerializeResult> {
  const json = JSON.stringify(output ?? {});
  const sizeInBytes = new Blob([json]).size;

  const mustUseStorage = !!oldStorageId;
  const shouldUseStorage = mustUseStorage || sizeInBytes >= SIZE_THRESHOLD;

  debugLog('serializeOutput Output size:', {
    sizeInBytes,
    threshold: SIZE_THRESHOLD,
    mustUseStorage,
    willUseStorage: shouldUseStorage,
  });

  if (!shouldUseStorage) {
    return { serialized: json };
  }

  const blob = new Blob([json], { type: 'application/json' });
  const storageId = await ctx.storage.store(blob);

  return {
    serialized: JSON.stringify({ _storageRef: storageId }),
    storageId,
  };
}
