'use node';

/**
 * 0.3.4 / 04 — remove the retired workforce persona agents from org disk.
 *
 * The `agents/workforce/` catalog folder (CEO/CTO/CMO persona agents) left the
 * builtin catalog; the org-scaffolded copies under `<org>/agents/workforce/`
 * are deleted here so the catalog and list views stop offering retired
 * personas. Installation rows are handled by the sibling db migration
 * (0.3.4/05). A per-org fs-tree snapshot of the agents directory is taken
 * first so `down` can restore the prior files.
 */

import path from 'node:path';

import { resolveAgentsDir } from '../../../../legacy/frozen/agents_file_utils';
import { defineNodeMigration } from '../../../framework/define';

export const migration = defineNodeMigration({
  title: 'Delete the retired workforce persona agent files',
  description:
    'Deletes the <org>/agents/workforce/ subtree (the retired persona ' +
    'catalog: CEO/CTO/CMO and their teams). Idempotent: orgs without the ' +
    'folder are untouched; other agent folders are never touched. A per-org ' +
    'fs-tree snapshot of the agents directory is taken first so down can ' +
    'restore the prior files.',
  destructive: true,
  snapshot: 'fs-tree',
  formerIds: ['0.2.90/05_remove_workforce_agents'],
  subjects: { domains: ['agents'] },

  async up(_ctx, org, helpers) {
    const dir = resolveAgentsDir(org.slug);
    await helpers.snapshotFsTree(dir);
    const removed = await helpers.removeDirSafe(path.join(dir, 'workforce'));
    if (removed) {
      console.log(
        `[${helpers.migrationId}] removed agents/workforce for ${org.slug}`,
      );
    }
  },

  async down(_ctx, org, helpers) {
    const dir = resolveAgentsDir(org.slug);
    await helpers.restoreFsTree(dir);
  },
});
