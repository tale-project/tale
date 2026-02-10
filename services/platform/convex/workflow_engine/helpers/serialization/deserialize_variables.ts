/**
 * Deserialize variables from JSON string
 *
 * Supports both inline JSON and storage references.
 * Use this function in action context to fetch from storage.
 */

import type { Id } from '../../../_generated/dataModel';

import { createDebugLog } from '../../../lib/debug_log';
import { toId } from '../../../lib/type_cast_helpers';

const debugLog = createDebugLog('DEBUG_WORKFLOW', '[Workflow]');

/**
 * Deserialize variables in action context (supports storage fetch)
 *
 * This version can fetch from Convex storage using ctx.storage.get()
 * which is only available in actions.
 */
export async function deserializeVariablesInAction(
  ctx: { storage: { get: (id: Id<'_storage'>) => Promise<Blob | null> } },
  variablesSerialized: string | undefined | null,
): Promise<Record<string, unknown>> {
  if (!variablesSerialized) {
    return {};
  }

  const parsed = JSON.parse(variablesSerialized);

  // Check if this is a storage reference
  if (parsed._storageRef) {
    const storageId = toId<'_storage'>(parsed._storageRef);
    debugLog(
      'deserializeVariablesInAction Fetching variables from storage:',
      storageId,
    );

    const blob = await ctx.storage.get(storageId);
    if (!blob) {
      console.error(
        '[deserializeVariablesInAction] Variables storage file not found:',
        storageId,
      );
      throw new Error(`Variables storage file not found: ${storageId}`);
    }

    const text = await blob.text();
    return JSON.parse(text);
  }

  // Regular inline variables
  return typeof parsed === 'object' && parsed !== null ? parsed : {};
}
