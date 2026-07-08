'use node';

/**
 * Node migration: delete the retired `agents/workforce/` persona folder from
 * every org. See {@link meta}.
 */

import path from 'node:path';

import { resolveAgentsDir } from '../../../../agents/file_utils';
import type { NodeMigration } from '../../../framework/types';
import { meta } from './meta';

export const migration: NodeMigration = {
  meta,
  async up(_ctx, org, helpers) {
    const dir = resolveAgentsDir(org.slug);
    await helpers.snapshotFsTree(meta.id, org.slug, dir);
    const removed = await helpers.removeDirSafe(path.join(dir, 'workforce'));
    if (removed) {
      console.log(`[${meta.id}] removed agents/workforce for ${org.slug}`);
    }
  },

  async down(_ctx, org, helpers) {
    const dir = resolveAgentsDir(org.slug);
    await helpers.restoreFsTree(meta.id, org.slug, dir);
  },
};
