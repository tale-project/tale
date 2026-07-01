/**
 * DB migration over `threadFiles`: fold the flat `path` + `source` into the
 * single canonical absolute `/user/<root>/<name>` path. See {@link meta}.
 *
 * `up` prepends the source's root; `down` strips it. Both are idempotent and
 * lose no data. No storage blobs are touched — only the `path` string changes.
 */

import type { Id } from '../../../../_generated/dataModel';
import type { MutationCtx } from '../../../../_generated/server';
import type { DbMigration, MigrationDoc } from '../../../framework/types';
import { meta } from './meta';

const ROOT_BY_SOURCE: Record<string, string> = {
  user_upload: '/user/uploads',
  agent_write: '/user/code',
  run_output: '/user/output',
};

const ABSOLUTE_RE = /^\/user\/(?:uploads|code|output)\/(.+)$/;

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export const migration: DbMigration = {
  meta,
  table: 'threadFiles',

  async up(ctx: MutationCtx, doc: MigrationDoc) {
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

  async down(ctx: MutationCtx, doc: MigrationDoc) {
    const path = str(doc.path);
    if (path === undefined) return;
    const m = ABSOLUTE_RE.exec(path);
    if (m === null) return; // already relative — idempotent
    await ctx.db.patch(doc._id as Id<'threadFiles'>, { path: m[1] });
  },
};
