'use node';

/**
 * Node migration: delete the three retired workflows (file + rows) from
 * every org. See {@link meta}.
 */

import path from 'node:path';

import { internal } from '../../../../_generated/api';
import { resolveWorkflowsDir } from '../../../../workflows/file_utils';
import type { NodeMigration } from '../../../framework/types';
import { meta } from './meta';

/** Slugs of the retired pack workflows (relative-path form, no `.json`). */
export const RETIRED_WORKFLOW_SLUGS = [
  'projects/tasks/reassign-paused-agent-work',
  'projects/tasks/send-daily-digest',
  'projects/discussions/triage-new-discussion',
] as const;

export const migration: NodeMigration = {
  meta,
  async up(ctx, org, helpers) {
    const dir = resolveWorkflowsDir(org.slug);
    await helpers.snapshotFsTree(meta.id, org.slug, dir);

    for (const slug of RETIRED_WORKFLOW_SLUGS) {
      const removed = await helpers.removeFileSafe(
        path.join(dir, ...slug.split('/')) + '.json',
      );
      // The rows must go even when the file is already gone (a previous
      // partial run) — removeDefaultProvisioning is itself idempotent.
      const rows: unknown = await ctx.runMutation(
        internal.workflows.provision_defaults_mutations
          .removeDefaultProvisioning,
        { organizationId: org.id, workflowSlug: slug },
      );
      console.log(`[${meta.id}] ${org.slug} ${slug}`, { removed, rows });
    }
  },

  async down(ctx, org, helpers) {
    const dir = resolveWorkflowsDir(org.slug);
    await helpers.restoreFsTree(meta.id, org.slug, dir);
    // The provision markers were deleted in `up`, so the provisioner
    // re-installs the restored autoInstall files and recreates their
    // trigger rows.
    await ctx.runAction(
      internal.workflows.provision_defaults.syncDefaultWorkflowInstallations,
      { organizationId: org.id, orgSlug: org.slug },
    );
  },
};
