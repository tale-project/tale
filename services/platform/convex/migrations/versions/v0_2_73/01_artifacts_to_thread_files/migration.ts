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
 * `table-rows` snapshot of `artifacts` would back a true reversal). Per-row,
 * idempotent, shape-guarded. Reference-only: the runner never executes it —
 * the test calls `up`/`down` directly.
 */

import type { MutationCtx } from '../../../../_generated/server';
import { defineReferenceMigration } from '../../../framework/define';

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Map an artifact `type` to a file extension + MIME for the synthesised path. */
const EXT_BY_TYPE: Record<string, { ext: string; mime: string }> = {
  html: { ext: 'html', mime: 'text/html' },
  svg: { ext: 'svg', mime: 'image/svg+xml' },
  markdown: { ext: 'md', mime: 'text/markdown' },
  mermaid: { ext: 'mmd', mime: 'text/vnd.mermaid' },
  code: { ext: 'txt', mime: 'text/plain' },
};

/** POSIX-relative path for the artifact's title + type. Best-effort. */
function synthPath(title: string, type: string): string {
  const { ext } = EXT_BY_TYPE[type] ?? { ext: 'txt' };
  const base = (title || 'artifact')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${base || 'artifact'}.${ext}`;
}

async function findThreadFile(
  ctx: MutationCtx,
  threadId: string,
  path: string,
) {
  return await ctx.db
    .query('threadFiles')
    .withIndex('by_thread_and_path', (q) =>
      q.eq('threadId', threadId).eq('path', path),
    )
    .first();
}

export const migration = defineReferenceMigration({
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
  destructive: true,
  snapshot: 'table-rows',
  table: 'artifacts',

  async up(ctx, doc) {
    const organizationId = str(doc.organizationId);
    const threadId = str(doc.threadId);
    const type = str(doc.type) ?? 'code';
    const title = str(doc.title) ?? 'artifact';
    const content = str(doc.content) ?? '';
    if (!organizationId || !threadId) return;

    const path = synthPath(title, type);

    // Idempotent: one threadFiles row per (threadId, path).
    if (await findThreadFile(ctx, threadId, path)) return;

    const mime = EXT_BY_TYPE[type]?.mime ?? 'text/plain';
    // Move inline content into storage to obtain a storageId. NOTE: a real run
    // of this transform would require an action context (`storage.store` is not
    // on a mutation's StorageWriter). This is a REFERENCE migration the runner
    // never executes, so the cast documents the intended shape without claiming
    // mutation-context runnability.
    const blob = new Blob([content], { type: mime });
    // oxlint-disable-next-line typescript/no-explicit-any -- store needs an action ctx; reference-only
    const storageId = await (ctx.storage as any).store(blob);

    const now = Date.now();
    await ctx.db.insert('threadFiles', {
      organizationId,
      threadId,
      path,
      storageId,
      size: content.length,
      contentType: mime,
      source: 'agent_write',
      createdAt: now,
      updatedAt: now,
    });
  },

  async down(ctx, doc) {
    const threadId = str(doc.threadId);
    const type = str(doc.type) ?? 'code';
    const title = str(doc.title) ?? 'artifact';
    if (!threadId) return;

    const path = synthPath(title, type);
    const existing = await findThreadFile(ctx, threadId, path);
    if (!existing) return; // already reverted / never created

    // Free the storage blob, then delete the row.
    await ctx.storage.delete(existing.storageId);
    await ctx.db.delete(existing._id);
  },
});
