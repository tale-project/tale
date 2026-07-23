'use node';

/**
 * 0.3.4 / 35 — remove the retired standalone workflows tree.
 *
 * By this point 33 has re-seeded every org's `automations/` dir with the
 * bundles that carry each builtin workflow inline and wrapped org-authored
 * standalone files into org automations, so the `workflows/` config tree
 * (definitions, per-workflow `.history/`, the domain dir itself) is dead
 * weight the retired config domain no longer reads. Delete it wholesale —
 * a per-org fs-tree snapshot is taken first, and `down` restores the tree
 * byte-for-byte (inline-workflow edit history restarts under
 * `automations/<slug>/.history/`; the old trails live on in the snapshot).
 */

// LEGACY-CHAIN import: the resolver survives solely for pre-cutover
// migrations addressing org trees mid-upgrade (see config_store/resolvers.ts).
import { resolveWorkflowsDir } from '../../../../legacy/frozen/workflows_file_utils';
import { defineNodeMigration } from '../../../framework/define';

export const migration = defineNodeMigration({
  title: 'Remove the retired standalone workflows tree',
  description:
    "Deletes each org's workflows/ config tree after 33 seeded the " +
    'automations that now carry every builtin definition inline and wrapped ' +
    'org-authored ones; a per-org fs-tree snapshot is taken first and down ' +
    'restores the tree byte-for-byte.',
  destructive: true,
  snapshot: 'fs-tree',
  subjects: { domains: ['workflows'] },

  async up(_ctx, org, helpers) {
    const dir = resolveWorkflowsDir(org.slug);
    await helpers.snapshotFsTree(dir);
    const removed = await helpers.removeDirSafe(dir);
    if (removed) {
      console.log(
        `[${helpers.migrationId}] removed workflows/ for ${org.slug}`,
      );
    }
  },

  async down(_ctx, org, helpers) {
    await helpers.restoreFsTree(resolveWorkflowsDir(org.slug));
  },
});
