import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.2.88 / 02 — give a `scope: 'project'` app's reconcile SCHEDULE a project.
 *
 * Per-project config means one schedule per bound project; existing installs
 * have a single org-level schedule (`projectId` unset). This assigns each
 * org-level, app-owned schedule to its app's binding so `setAppConfig(projectId)`
 * can sync it and lifecycle (create-on-bind / delete-on-unbind) is keyed right.
 * Idempotent — skips a schedule that already has a `projectId`. `down` unsets
 * `projectId` on app-owned schedules.
 *
 * Non-destructive: only sets the new optional `projectId`, never deletes a row.
 * For the rare case of an app bound to several projects, the schedule is assigned
 * to the FIRST binding; the reconcile run itself updates tasks across projects by
 * their external ref, and a per-project schedule for the others materializes on
 * the next (re)bind via `syncAppSchedules`.
 */
export const meta: MigrationMeta = {
  id: '0.2.88/02_app_schedules_per_project',
  semver: '0.2.88',
  numericId: 2,
  slug: 'app_schedules_per_project',
  title: 'Assign org-level app schedules to their project binding',
  description:
    'Sets wfSchedules.projectId on each org-level schedule owned by a ' +
    "scope:project app to that app's (first) project binding, so per-project " +
    'config syncs to it. Idempotent — skips a schedule that already has a ' +
    'projectId. Non-destructive. down unsets projectId on app-owned schedules.',
  kind: 'db',
  reversible: true,
  destructive: false,
  snapshot: 'none',
};
