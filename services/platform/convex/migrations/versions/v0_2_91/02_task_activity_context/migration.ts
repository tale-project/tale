/**
 * 0.2.91 / 02 — optional `taskActivity.context` for workflow attribution.
 *
 * Adds an optional object `{ workflowSlug?, wfExecutionId? }` so workflow-engine
 * writes can name which automation drove a timeline row. Purely additive — every
 * existing row stays valid without the field.
 *
 * up: NO-OP. New rows populate `context` at write time; historical rows remain
 * without it.
 * down: drop `context` when present so rows re-validate against the pre-change
 * schema. Idempotent.
 */

import { defineReferenceMigration } from '../../../framework/define';

export const migration = defineReferenceMigration({
  title: 'Add optional taskActivity.context for workflow attribution',
  description:
    'Adds the optional taskActivity.context object (workflowSlug + ' +
    'wfExecutionId) so workflow-driven audit rows can deep-link to the ' +
    'automation that wrote them. Purely additive; up is a documented no-op ' +
    'and down drops context to re-validate against the pre-change schema. ' +
    'Reference-only: the runner never executes it.',
  destructive: false,
  snapshot: 'none',
  table: 'taskActivity',

  async up(_ctx, _doc) {
    // No-op: optional field — existing rows stay valid without `context`.
  },

  async down(ctx, doc) {
    if (doc.context === undefined) return;
    // oxlint-disable-next-line typescript/no-explicit-any -- dropped optional field
    await (ctx.db as any).patch(doc._id, { context: undefined });
  },
});
