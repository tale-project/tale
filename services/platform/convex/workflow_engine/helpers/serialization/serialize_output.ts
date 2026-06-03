/**
 * Serialize output helpers
 *
 * Similar to serialize_variables.ts but for workflow execution output.
 * - In actions: can upload to Convex storage (store + get + getUrl)
 * - In mutations: can only inline JSON or delete existing storage
 */

import type { Id } from '../../../_generated/dataModel';
import type { ActionCtx } from '../../../_generated/server';
import { SerializeResult, serializeToStorage } from './serialize_variables';

/**
 * Action-safe serializer: stores large output in Convex storage and returns a reference.
 */
export async function serializeOutput(
  ctx: ActionCtx,
  output: unknown,
  oldStorageId?: Id<'_storage'>,
): Promise<SerializeResult> {
  return serializeToStorage(
    ctx,
    output,
    oldStorageId,
    'serializeOutput Output size:',
  );
}
