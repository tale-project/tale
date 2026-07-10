/**
 * DB migration over `appProjectBindings`: fold a bound project's install-time
 * `config` (owner/repo/testCommand/repoNotes) onto its `issue-desk/reconcile`
 * schedule's `wfSchedules.variables`, then clear `config` on the binding AND
 * on the org-level `appInstallations` row for the same (org, appSlug).
 *
 * Part of retiring the app manifest's `requires.config` concept: an app no
 * longer collects install-time config, so any value an operator already
 * entered (e.g. a GitHub repo) must move to where a workflow reads its own
 * settings — its schedule's `variables` — before `appProjectBindings.config` /
 * `appInstallations.config` disappear from the schema (see `apps/schema.ts`).
 *
 * DELIBERATE DEVIATION from `snapshot: 'table-rows'`: that strategy's rollback
 * (`restoreSnapshotBatch`) re-INSERTS the snapshotted payload as a brand-new
 * row without deleting the row `up` left behind — correct only when `up`
 * fully DELETES the row (as the retired-table migrations do). This migration
 * PATCHES a live, still-bound row (clearing one field, not removing it), so
 * `table-rows` would leave TWO `appProjectBindings` rows for the same
 * (org, appSlug, project) after a rollback. Instead this is `snapshot: 'none'`
 * with a hand-written `down` that reads the config back OFF the schedule it
 * was folded into (the same round-trip-through-another-table shape as
 * `0.2.88/01_app_config_to_bindings`), so no separate backup is needed for the
 * binding's own config.
 *
 * Known limitation (accepted, documented): `down` restores the per-project
 * `appProjectBindings.config` (the value `getAppConfig` actually served) but
 * NOT the org-level `appInstallations.config` legacy default — by 0.2.88 that
 * field was already folded into every binding and read only as a fallback, so
 * losing it on rollback does not change any org's served config.
 *
 * `destructive: false` (like `0.2.88/01`): `up` clears two fields, but no
 * value is lost — it round-trips through the schedule's `variables`, and
 * `down` reads it back (see the limitation above for the one narrow
 * exception). `check-migrations.ts` refuses `destructive:true` + `snapshot:
 * 'none'` on the (correct, in general) assumption that `none` means nothing
 * backs up the data — here the schedule row IS that backup, so this is the
 * "reversible field split" case `SnapshotStrategy`'s own doc names, not a
 * true destructive/unrecoverable change; running it should not need an
 * operator's explicit `allowDestructive` accept.
 *
 * `config` is absent from both tables' CURRENT schema (this migration exists
 * to clear out what the previous schema still allowed) — every read/write of
 * it below is therefore untyped (`as any`), matching the framework's
 * convention for a field predating the live schema.
 */

import type { Id } from '../../../../_generated/dataModel';
import type { MutationCtx } from '../../../../_generated/server';
import { defineDbMigration } from '../../../framework/define';

/** The only workflow in the bundle that carries a schedule (per project). */
const RECONCILE_WORKFLOW_SLUG = 'issue-desk/reconcile';

/** The `requires.config` keys the retired issue-desk manifest declared. */
const CONFIG_KEYS = ['owner', 'repo', 'testCommand', 'repoNotes'] as const;

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Only the recognized, defined keys — drops the raw `repository` composite
 *  (its derived `owner`/`repo` are what templates actually bind). */
function pickConfigVars(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of CONFIG_KEYS) {
    if (config[key] !== undefined) out[key] = config[key];
  }
  return out;
}

/** The bound project's reconcile schedule — at most one per (org, project),
 *  created at bind time by `syncAutomationSchedules` (mirrors its own lookup shape). */
async function findReconcileSchedule(
  ctx: MutationCtx,
  organizationId: string,
  projectId: Id<'projects'>,
) {
  for await (const sched of ctx.db
    .query('wfSchedules')
    .withIndex('by_workflowSlug', (q) =>
      q.eq('workflowSlug', RECONCILE_WORKFLOW_SLUG),
    )) {
    if (sched.organizationId !== organizationId) continue;
    if (sched.projectId !== projectId) continue;
    return sched;
  }
  return null;
}

export const migration = defineDbMigration({
  title:
    "Fold appProjectBindings.config into the reconcile schedule's variables",
  description:
    'For each appProjectBindings row with a non-empty config, copies its ' +
    "owner/repo/testCommand/repoNotes onto that project's issue-desk/reconcile " +
    'wfSchedules.variables (merged, config wins), then clears config on the ' +
    'binding and on the matching appInstallations row. down reads those same ' +
    'keys back off the schedule and restores appProjectBindings.config (the ' +
    'appInstallations legacy copy is not restored — see meta comment).',
  destructive: false,
  snapshot: 'none',
  subjects: {
    tables: ['appProjectBindings', 'wfSchedules', 'appInstallations'],
  },
  table: 'appProjectBindings',

  async up(ctx, doc) {
    const config = record(doc.config);
    if (!config || Object.keys(config).length === 0) return;
    const organizationId = str(doc.organizationId);
    const appSlug = str(doc.appSlug);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- MigrationDoc ids are untyped by design
    const projectId = doc.projectId as Id<'projects'> | undefined;
    if (!organizationId || !appSlug || !projectId) return;

    const picked = pickConfigVars(config);
    if (Object.keys(picked).length > 0) {
      const sched = await findReconcileSchedule(ctx, organizationId, projectId);
      if (sched) {
        await ctx.db.patch(sched._id, {
          variables: { ...sched.variables, ...picked },
        });
      }
    }

    // oxlint-disable-next-line typescript/no-explicit-any -- config absent from the current schema
    await (ctx.db as any).patch(doc._id, { config: undefined });

    // Same org-level row may be patched once per bound project — idempotent
    // (the second+ patch is a no-op once config is already undefined).
    const install = await (ctx.db as any)
      .query('appInstallations')
      .withIndex('by_org_slug', (q: any) =>
        q.eq('organizationId', organizationId).eq('appSlug', appSlug),
      )
      .first();
    if (install && install.config !== undefined) {
      // oxlint-disable-next-line typescript/no-explicit-any -- config absent from the current schema
      await (ctx.db as any).patch(install._id, { config: undefined });
    }
  },

  async down(ctx, doc) {
    // Idempotent + never clobbers a post-migration edit: only fill a binding
    // that currently carries no config of its own.
    if (doc.config !== undefined) return;
    const organizationId = str(doc.organizationId);
    const appSlug = str(doc.appSlug);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- MigrationDoc ids are untyped by design
    const projectId = doc.projectId as Id<'projects'> | undefined;
    if (!organizationId || !appSlug || !projectId) return;

    const sched = await findReconcileSchedule(ctx, organizationId, projectId);
    if (!sched) return;
    const variables = record(sched.variables) ?? {};
    const restored = pickConfigVars(variables);
    if (Object.keys(restored).length === 0) return;

    // NOTE (accepted edge case): if the schedule's owner/repo/testCommand/
    // repoNotes were instead set by an operator directly (e.g. a future
    // Triggers-tab edit) rather than by this migration's `up`, this restores
    // that value onto the binding as if it were the migrated config. There is
    // no snapshot to disambiguate the two origins — see the header's doc
    // comment.
    // oxlint-disable-next-line typescript/no-explicit-any -- config absent from the current schema
    await (ctx.db as any).patch(doc._id, { config: restored });

    const remainingVariables = { ...variables };
    for (const key of CONFIG_KEYS) delete remainingVariables[key];
    await ctx.db.patch(sched._id, { variables: remainingVariables });
  },
});
