/**
 * 0.2.1 / 01 — rename `agentBindings.agentFileName` → `agentSlug`.
 *
 * Shipped in v0.2.1 (verified against `git diff v0.2.0 v0.2.1 --
 * convex/agents/schema.ts`): the field was renamed and the `by_org_agent`
 * index recolumned from `['organizationId', 'agentFileName']` to
 * `['organizationId', 'agentSlug']`. Pure rename — fully reversible from the
 * data already present, no information lost. The index recolumn is a schema
 * concern outside this row transform.
 *
 * Reference-only: this already shipped in a tagged release and CANNOT be
 * replayed (Convex validates rows against today's schema at push, where
 * `agentFileName` no longer exists). The per-row transform is idempotent and
 * shape-guarded and stays under round-trip test for the audit trail; the
 * runner never executes it — the test calls `up`/`down` directly.
 */

import { defineReferenceMigration } from '../../../framework/define';

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export const migration = defineReferenceMigration({
  title: 'Rename agentBindings.agentFileName to agentSlug',
  description:
    'Renames the agentBindings.agentFileName field to agentSlug (and recolumns ' +
    'the by_org_agent index). up copies agentFileName into agentSlug and unsets ' +
    'agentFileName; down does the inverse. Pure rename, fully reversible, no ' +
    'data loss.',
  destructive: false,
  snapshot: 'none',
  table: 'agentBindings',

  async up(ctx, doc) {
    // Already migrated (has agentSlug, no agentFileName) → no-op.
    if (doc.agentFileName === undefined) return;
    const agentFileName = str(doc.agentFileName);
    if (agentFileName === undefined) return;
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy field absent from schema
    await (ctx.db as any).patch(doc._id, {
      agentSlug: agentFileName,
      agentFileName: undefined,
    });
  },

  async down(ctx, doc) {
    if (doc.agentSlug === undefined) return;
    const agentSlug = str(doc.agentSlug);
    if (agentSlug === undefined) return;
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy field absent from schema
    await (ctx.db as any).patch(doc._id, {
      agentFileName: agentSlug,
      agentSlug: undefined,
    });
  },
});
