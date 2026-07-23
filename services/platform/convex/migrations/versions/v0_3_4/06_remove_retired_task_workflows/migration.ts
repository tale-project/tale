'use node';

/**
 * 0.3.4 / 06 — remove the three retired pack workflows.
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

import path from 'node:path';

import { retired } from '../../../../legacy/frozen/retired_refs';
import { resolveWorkflowsDir } from '../../../../legacy/frozen/workflows_file_utils';
import { defineNodeMigration } from '../../../framework/define';

/** Slugs of the retired pack workflows (relative-path form, no `.json`). */
export const RETIRED_WORKFLOW_SLUGS = [
  'projects/tasks/reassign-paused-agent-work',
  'projects/tasks/send-daily-digest',
  'projects/discussions/triage-new-discussion',
] as const;

export const migration = defineNodeMigration({
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
  destructive: true,
  snapshot: 'fs-tree',
  formerIds: ['0.2.90/07_remove_retired_task_workflows'],
  subjects: {
    tables: [
      'wfInstallations',
      'wfEventSubscriptions',
      'wfSchedules',
      'wfDefaultProvisions',
    ],
    domains: ['workflows'],
  },

  async up(ctx, org, helpers) {
    const dir = resolveWorkflowsDir(org.slug);
    await helpers.snapshotFsTree(dir);

    for (const slug of RETIRED_WORKFLOW_SLUGS) {
      const removed = await helpers.removeFileSafe(
        path.join(dir, ...slug.split('/')) + '.json',
      );
      // The rows must go even when the file is already gone (a previous
      // partial run) — removeDefaultProvisioning is itself idempotent.
      const rows: unknown = await ctx.runMutation(
        retired.workflows.provision_defaults_mutations
          .removeDefaultProvisioning,
        { organizationId: org.id, workflowSlug: slug },
      );
      console.log(`[${helpers.migrationId}] ${org.slug} ${slug}`, {
        removed,
        rows,
      });
    }
  },

  async down(ctx, org, helpers) {
    const dir = resolveWorkflowsDir(org.slug);
    await helpers.restoreFsTree(dir);
    // The provision markers were deleted in `up`, so the provisioner
    // re-installs the restored autoInstall files and recreates their
    // trigger rows.
    await ctx.runAction(
      retired.workflows.provision_defaults.syncDefaultWorkflowInstallations,
      { organizationId: org.id, orgSlug: org.slug },
    );
  },
});
