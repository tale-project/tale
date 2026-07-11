/**
 * 0.2.96 / 03 — rewrite `threadFiles.path` to the canonical absolute
 * `/user/<root>/<name>` form.
 *
 * The thread workspace is now one virtual filesystem rooted at `/user`, mounted
 * 1:1 by the sandbox, with ONE canonical path per file used by every file tool,
 * by `run_code` scripts, and by staging/harvest — no per-tool conversion. This
 * folds the old flat path + `source` into the single absolute path implied by
 * that `source` (`user_upload`→`/user/uploads`, `agent_write`→`/user/code`,
 * `run_output`→`/user/output`). `source` stays as denormalized provenance.
 *
 * `up` prepends the root; `down` strips it. Both are idempotent (skip a row
 * already in the target shape) and lose no data — a pure, reversible rename.
 * No storage blobs are touched — only the `path` string changes.
 */

import type { Id } from '../../../../_generated/dataModel';
import { defineDbMigration } from '../../../framework/define';

const ROOT_BY_SOURCE: Record<string, string> = {
  user_upload: '/user/uploads',
  agent_write: '/user/code',
  run_output: '/user/output',
};

const ABSOLUTE_RE = /^\/user\/(?:uploads|code|output)\/(.+)$/;

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export const migration = defineDbMigration({
  title: 'Rewrite thread workspace file paths to absolute /user/<root>/ form',
  description:
    'Folds threadFiles.path (flat relative + source) into the single canonical ' +
    'absolute /user/{uploads,code,output}/<name> path implied by its source, so ' +
    'file tools, run_code, and staging/harvest all share one scheme. up prepends ' +
    'the root; down strips it. Idempotent, reversible, non-destructive.',
  destructive: false,
  snapshot: 'none',
  formerIds: ['0.2.89/02_thread_files_absolute_paths'],
  subjects: { tables: ['threadFiles'] },
  table: 'threadFiles',

  async up(ctx, doc) {
    const path = str(doc.path);
    const source = str(doc.source);
    if (path === undefined || source === undefined) return;
    if (path.startsWith('/user/')) return; // already absolute — idempotent
    const root = ROOT_BY_SOURCE[source];
    if (root === undefined) return;
    await ctx.db.patch(doc._id as Id<'threadFiles'>, {
      path: `${root}/${path}`,
    });
  },

  async down(ctx, doc) {
    const path = str(doc.path);
    if (path === undefined) return;
    const m = ABSOLUTE_RE.exec(path);
    if (m === null) return; // already relative — idempotent
    await ctx.db.patch(doc._id as Id<'threadFiles'>, { path: m[1] });
  },
});
