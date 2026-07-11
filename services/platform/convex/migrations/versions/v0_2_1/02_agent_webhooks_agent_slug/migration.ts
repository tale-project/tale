/**
 * 0.2.1 / 02 — rename `agentWebhooks.agentFileName` → `agentSlug`.
 *
 * Shipped in v0.2.1 (verified against `git diff v0.2.0 v0.2.1 --
 * convex/agents/webhooks/schema.ts`): the field was renamed and the
 * `by_agent` index recolumned from `['organizationId', 'agentFileName']` to
 * `['organizationId', 'agentSlug']`. Pure rename — fully reversible, no data
 * lost.
 *
 * Reference-only: already shipped; cannot be replayed against today's schema.
 * The per-row transform is idempotent and shape-guarded and stays under
 * round-trip test for the audit trail; the runner never executes it — the
 * test calls `up`/`down` directly.
 */

import { defineReferenceMigration } from '../../../framework/define';

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export const migration = defineReferenceMigration({
  title: 'Rename agentWebhooks.agentFileName to agentSlug',
  description:
    'Renames the agentWebhooks.agentFileName field to agentSlug (and recolumns ' +
    'the by_agent index). up copies agentFileName into agentSlug and unsets ' +
    'agentFileName; down does the inverse. Pure rename, fully reversible, no ' +
    'data loss.',
  destructive: false,
  snapshot: 'none',
  table: 'agentWebhooks',

  async up(ctx, doc) {
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
