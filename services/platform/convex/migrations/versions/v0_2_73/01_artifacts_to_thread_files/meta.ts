import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.2.73 / 01 — re-key `artifacts` (+ `artifactRevisions`) into `threadFiles`.
 *
 * UNCERTAINTY (verified, not resolved by code): NO real backfill ever shipped.
 * `git log` over the artifacts paths shows the artifacts stack was introduced
 * (fd3d74eb3) and removed when the thread-workspace landed (42341263a) with no
 * migration that references `threadFiles`, and a `git grep` for `threadFiles`
 * across the migrations tree at v0.2.73 is empty. The artifacts table is simply
 * gone at v0.2.73 and `threadFilesTable` is its documented successor ("replaces
 * the old artifact / artifact-file / artifact-output / runnable-artifact
 * stack"). So this is a BEST-EFFORT documented transform, not a replay of
 * shipped code.
 *
 * Shape gap: an `artifacts` row stored its body INLINE as `content: v.string()`
 * and had NO `path` or `storageId`; a `threadFiles` row stores `storageId:
 * v.id('_storage')` plus a POSIX `path`. So `up` must (a) put the inline
 * `content` into Convex storage to obtain a `storageId`, (b) synthesise a
 * `path` from the artifact `title` + a `type`-derived extension, and (c) insert
 * a `threadFiles` row keyed by `(threadId, path, storageId)` with `source:
 * 'agent_write'`. The synthesised path/extension is a best guess — the original
 * artifact carried no path.
 *
 * down: delete the `threadFiles` rows this migration created (matched by
 * `(threadId, path)`), restoring the pre-migration state. The original
 * `artifacts` rows are left intact by `up` (they are dropped by the schema
 * change, outside this row transform), so `down` need only undo the inserts.
 *
 * `destructive: true` (re-keys rows into a new table; conceptually a
 * `table-rows` snapshot of `artifacts` would back a true reversal).
 * Reference-only: the runner never executes it.
 */
export const meta: MigrationMeta = {
  id: '0.2.73/01_artifacts_to_thread_files',
  semver: '0.2.73',
  numericId: 1,
  slug: 'artifacts_to_thread_files',
  title: 'Re-key artifacts into threadFiles',
  description:
    'BEST-EFFORT, UNCERTAIN: no real backfill shipped (the artifacts stack was ' +
    'deleted at v0.2.73 with no threadFiles-referencing migration in history); ' +
    'threadFilesTable is its documented successor. Artifacts stored content ' +
    'inline with no path/storageId, so up stores the content blob to obtain a ' +
    'storageId, synthesises a path from title + a type-derived extension, and ' +
    'inserts a threadFiles row (source agent_write) keyed by ' +
    '(threadId, path, storageId). down deletes the matching threadFiles rows. ' +
    'The synthesised path is a best guess.',
  kind: 'reference',
  reversible: true,
  destructive: true,
  snapshot: 'table-rows',
};
