/**
 * Snapshot helpers a `table-rows` migration's `up` calls to back up a row
 * before destroying it. Kept in its own module (no registry import) so
 * migration handlers can use it without creating a runner ↔ registry cycle.
 */

import type { MutationCtx } from '../../_generated/server';
import type { MigrationDoc } from './types';

/** Strip Convex system fields so a payload can be re-inserted as a fresh row. */
export function stripSystemFields(
  doc: Record<string, unknown>,
): Record<string, unknown> {
  const { _id, _creationTime, ...rest } = doc;
  void _id;
  void _creationTime;
  return rest;
}

/**
 * Snapshot a single row into `migrationSnapshots`. Call from a `table-rows`
 * migration's `up` BEFORE deleting/overwriting the row so the generic
 * snapshot-restore `down` (`restoreSnapshotBatch`) can rebuild it.
 */
export async function snapshotRow(
  ctx: MutationCtx,
  migrationId: string,
  scope: string,
  doc: MigrationDoc,
): Promise<void> {
  await ctx.db.insert('migrationSnapshots', {
    migrationId,
    scope,
    payload: stripSystemFields(doc),
    createdAt: Date.now(),
  });
}

export async function snapshotBetterAuthRow(
  ctx: MutationCtx,
  migrationId: string,
  model: string,
  doc: Record<string, unknown>,
): Promise<void> {
  const id = typeof doc._id === 'string' ? doc._id : 'unknown';
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Better Auth component rows use string ids; MigrationDoc expects GenericId
  await snapshotRow(ctx, migrationId, `component:betterAuth:${model}:${id}`, {
    ...doc,
    _id: id,
  } as MigrationDoc);
}
