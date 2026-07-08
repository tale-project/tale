import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.2.91 / 01 — fold each `appProjectBindings` row's install-time `config`
 * (owner/repo/testCommand/repoNotes) onto that project's `issue-desk/reconcile`
 * `wfSchedules.variables`, then clear `config` on the binding AND on the
 * org-level `appInstallations` row for the same (org, appSlug).
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
 */
export const meta: MigrationMeta = {
  id: '0.2.91/01_app_config_to_schedule_variables',
  semver: '0.2.91',
  numericId: 1,
  slug: 'app_config_to_schedule_variables',
  title:
    "Fold appProjectBindings.config into the reconcile schedule's variables",
  description:
    'For each appProjectBindings row with a non-empty config, copies its ' +
    "owner/repo/testCommand/repoNotes onto that project's issue-desk/reconcile " +
    'wfSchedules.variables (merged, config wins), then clears config on the ' +
    'binding and on the matching appInstallations row. down reads those same ' +
    'keys back off the schedule and restores appProjectBindings.config (the ' +
    'appInstallations legacy copy is not restored — see meta comment).',
  kind: 'db',
  reversible: true,
  destructive: false,
  snapshot: 'none',
};
