/**
 * Reference migration: widen `documents.sourceProvider` literal union →
 * `v.string()`.
 *
 * `up` is a documented no-op (old literals are already valid strings). `down`
 * is asymmetric: it coerces any value outside the old literal set back to a
 * safe old literal so the row re-validates against the pre-widen schema. Both
 * are idempotent. The runner never executes a `reference` migration; the test
 * calls `up`/`down` directly.
 */

import type { MutationCtx } from '../../../../_generated/server';
import type { DbMigration, MigrationDoc } from '../../../framework/types';
import { meta } from './meta';

/** The literal set `sourceProvider` was constrained to before the widen. */
const OLD_LITERALS = new Set(['onedrive', 'upload', 'sharepoint', 'agent']);
/** Neutral fallback for any post-widen value not in the old set. */
const SAFE_FALLBACK = 'upload';

export const migration: DbMigration = {
  meta,
  table: 'documents',

  async up(_ctx: MutationCtx, _doc: MigrationDoc) {
    // No-op: widening a literal union to v.string() leaves every existing
    // value valid. Nothing to rewrite. Kept explicit + idempotent.
  },

  async down(ctx: MutationCtx, doc: MigrationDoc) {
    const provider = doc.sourceProvider;
    if (provider === undefined) return; // optional field absent → nothing to narrow
    if (typeof provider === 'string' && OLD_LITERALS.has(provider)) return; // already valid
    // Coerce any out-of-set value to the safe old literal so it re-validates.
    // oxlint-disable-next-line typescript/no-explicit-any -- widened field
    await (ctx.db as any).patch(doc._id, { sourceProvider: SAFE_FALLBACK });
  },
};
