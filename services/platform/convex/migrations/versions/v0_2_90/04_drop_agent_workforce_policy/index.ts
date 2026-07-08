'use node';

/**
 * Node migration: delete the retired `agent-workforce.json` governance policy
 * file from every org. See {@link meta}.
 */

import path from 'node:path';

import { resolveGovernanceDir } from '../../../../governance/file_utils';
import type { NodeMigration } from '../../../framework/types';
import { meta } from './meta';

export const migration: NodeMigration = {
  meta,
  async up(_ctx, org, helpers) {
    const dir = resolveGovernanceDir(org.slug);
    await helpers.snapshotFsTree(meta.id, org.slug, dir);
    const removed = await helpers.removeFileSafe(
      path.join(dir, 'agent-workforce.json'),
    );
    if (removed) {
      console.log(`[${meta.id}] removed agent-workforce.json for ${org.slug}`);
    }
  },

  async down(_ctx, org, helpers) {
    const dir = resolveGovernanceDir(org.slug);
    await helpers.restoreFsTree(meta.id, org.slug, dir);
  },
};
