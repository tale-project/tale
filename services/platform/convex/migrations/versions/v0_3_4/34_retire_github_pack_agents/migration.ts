'use node';

/**
 * 0.3.4 / 34 — retire the free-floating github and workforce agent files.
 *
 * The `agents/github/` builtins (issue-triager, pull-request-reviewer) died
 * with the integration-bundles mechanism — automations ship their own nested
 * agents now — and `agents/workforce/` returned for orgs scaffolded AFTER
 * 0.3.4/04 ran (the catalog kept shipping `software-developer.json` until
 * this release removed it). Delete both subtrees; a per-org fs-tree snapshot
 * of the agents directory is taken first so `down` restores the files.
 */

import path from 'node:path';

import { resolveAgentsDir } from '../../../../legacy/frozen/agents_file_utils';
import { defineNodeMigration } from '../../../framework/define';

export const migration = defineNodeMigration({
  title: 'Retire the free-floating github and workforce agents',
  description:
    "Deletes each org's scaffolded agents/github and agents/workforce config " +
    'files (the free-floating builtins retired with the integration-bundles ' +
    'mechanism; workforce returned for orgs scaffolded after 0.3.4/04). A ' +
    'per-org fs-tree snapshot of the agents directory is taken first; down ' +
    'restores the files byte-for-byte.',
  destructive: true,
  snapshot: 'fs-tree',
  subjects: { domains: ['agents'] },

  async up(_ctx, org, helpers) {
    const dir = resolveAgentsDir(org.slug);
    await helpers.snapshotFsTree(dir);
    for (const folder of ['github', 'workforce']) {
      const removed = await helpers.removeDirSafe(path.join(dir, folder));
      if (removed) {
        console.log(
          `[${helpers.migrationId}] removed agents/${folder} for ${org.slug}`,
        );
      }
    }
  },

  async down(_ctx, org, helpers) {
    await helpers.restoreFsTree(resolveAgentsDir(org.slug));
  },
});
