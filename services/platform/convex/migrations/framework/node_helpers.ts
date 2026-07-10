'use node';

/**
 * The single place the node-migration filesystem surface is assembled — thin
 * wrappers over `convex/lib/file_io` and the snapshot sidecar store — so
 * handler modules never import `node:*` directly. Used by the node runner in
 * production and imported by migration tests to build identical helpers.
 *
 * Also home of `composeNode`, the `'use node'` counterpart of `compose.ts`:
 * it pairs an authored `NodeMigrationSpec` with its derived meta and binds
 * the helpers to `(migrationId, orgSlug)` per invocation.
 */

import {
  atomicWrite,
  readFileSafe,
  removeDirSafe,
  removeFileSafe,
} from '../../lib/file_io';
import type {
  BoundNodeHelpers,
  MigrationModule,
  NodeMigrationSpec,
} from './define';
import { restoreFsTree, snapshotFsTree } from './snapshot_store';
import type {
  MigrationMeta,
  NodeMigration,
  NodeMigrationHelpers,
} from './types';

/**
 * The unbound helper surface legacy-shape node migrations receive (handlers
 * thread `migrationId`/`orgSlug` into the snapshot calls themselves). Deleted
 * with the legacy shape once every folder is ported to `defineNodeMigration`.
 */
export const legacyNodeHelpers: NodeMigrationHelpers = {
  atomicWrite,
  readFileSafe,
  removeFileSafe,
  removeDirSafe,
  snapshotFsTree,
  restoreFsTree,
};

/** Build the helper surface pre-bound to one migration × one org. */
export function makeNodeHelpers(
  migrationId: string,
  orgSlug: string,
): BoundNodeHelpers {
  return {
    migrationId,
    orgSlug,
    atomicWrite,
    readFileSafe,
    removeFileSafe,
    removeDirSafe,
    snapshotFsTree: (dir: string) => snapshotFsTree(migrationId, orgSlug, dir),
    restoreFsTree: (dir: string) => restoreFsTree(migrationId, orgSlug, dir),
  };
}

/** Pair a `node` spec with its derived meta, binding helpers per org. */
export function composeNode(
  meta: MigrationMeta,
  module: MigrationModule<'node', NodeMigrationSpec>,
): NodeMigration {
  const { spec } = module;
  return {
    meta,
    up: (ctx, org, _helpers) =>
      spec.up(ctx, org, makeNodeHelpers(meta.id, org.slug)),
    down: (ctx, org, _helpers) =>
      spec.down(ctx, org, makeNodeHelpers(meta.id, org.slug)),
  };
}
