import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.2.91 / 01 — optional `taskActivity.context` for workflow attribution.
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
export const meta: MigrationMeta = {
  id: '0.2.91/01_task_activity_context',
  semver: '0.2.91',
  numericId: 1,
  slug: 'task_activity_context',
  title: 'Add optional taskActivity.context for workflow attribution',
  description:
    'Adds the optional taskActivity.context object (workflowSlug + ' +
    'wfExecutionId) so workflow-driven audit rows can deep-link to the ' +
    'automation that wrote them. Purely additive; up is a documented no-op ' +
    'and down drops context to re-validate against the pre-change schema. ' +
    'Reference-only: the runner never executes it.',
  kind: 'reference',
  reversible: true,
  destructive: false,
  snapshot: 'none',
};
