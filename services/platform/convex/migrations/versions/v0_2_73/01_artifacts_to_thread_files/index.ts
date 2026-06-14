/**
 * Reference migration: re-key `artifacts` rows into `threadFiles`.
 *
 * BEST-EFFORT / UNCERTAIN — see meta.ts. No real backfill shipped; this is the
 * documented transform from the inline-content `artifacts` row to a
 * storage-backed `threadFiles` row.
 *
 * Per-row, idempotent, shape-guarded. The runner never executes a `reference`
 * migration; the test calls `up`/`down` directly.
 */

import type { MutationCtx } from '../../../../_generated/server';
import type { DbMigration, MigrationDoc } from '../../../framework/types';
import { meta } from './meta';

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

export const migration: DbMigration = {
  meta,
  table: 'artifacts',

  async up(ctx: MutationCtx, doc: MigrationDoc) {
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

  async down(ctx: MutationCtx, doc: MigrationDoc) {
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
};
