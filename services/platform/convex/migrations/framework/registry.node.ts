'use node';

/**
 * Node-migration handler registry. Separate from `registry.ts` because these
 * handlers are `'use node'` modules (they touch the filesystem) and must never
 * be value-imported by V8 code. Only the node runner imports this.
 */

import { migration as gov01 } from '../versions/v0_2_85/01_governance_db_to_json';
import type { NodeMigration } from './types';

/** Runnable `node` migrations, keyed by `meta.id`. */
export const NODE_MIGRATIONS: Readonly<Record<string, NodeMigration>> = {
  [gov01.meta.id]: gov01,
};
