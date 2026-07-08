import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.2.90 / 07 — remove the three retired pack workflows.
 *
 * `projects/tasks/reassign-paused-agent-work` (manager hand-off retired with
 * the org chart), `projects/tasks/send-daily-digest` (emitted the retired
 * `workforce_digest` notification type), and `projects/discussions/
 * triage-new-discussion` (routed new discussions to the retired Project
 * Manager agent) left the builtin pack. This migration deletes each org's
 * scaffolded copy AND its provisioning rows (installation, event
 * subscriptions, schedules, provision marker) so orphan triggers can't keep
 * firing into a deleted file. A per-org fs-tree snapshot of the workflows
 * directory is taken first; `down` restores the files and re-runs the
 * default-workflow provisioner, which recreates the rows.
 */
export const meta: MigrationMeta = {
  id: '0.2.90/07_remove_retired_task_workflows',
  semver: '0.2.90',
  numericId: 7,
  slug: 'remove_retired_task_workflows',
  title:
    'Delete the retired reassign-paused-agent-work + send-daily-digest + ' +
    'triage-new-discussion workflows',
  description:
    'Deletes <org>/workflows/projects/tasks/{reassign-paused-agent-work,' +
    'send-daily-digest}.json, <org>/workflows/projects/discussions/' +
    'triage-new-discussion.json, and their wfInstallations / trigger / ' +
    'provision rows. Idempotent: orgs without the files/rows are untouched; ' +
    'other workflows are never touched. A per-org fs-tree snapshot of the ' +
    'workflows directory is taken first; down restores the files and re-runs ' +
    'the default-workflow provisioner to recreate the rows.',
  kind: 'node',
  reversible: true,
  destructive: true,
  snapshot: 'fs-tree',
};
