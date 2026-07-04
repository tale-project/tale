'use node';

/**
 * Node-migration handler registry. Separate from `registry.ts` because these
 * handlers are `'use node'` modules (they touch the filesystem) and must never
 * be value-imported by V8 code. Only the node runner imports this.
 */

import { migration as gov01 } from '../versions/v0_2_85/01_governance_db_to_json';
import { migration as ssoUnify } from '../versions/v0_2_87/01_enterprise_sso_unify';
import { migration as runCodeExport } from '../versions/v0_2_87/02_run_code_policy_db_to_json';
import { migration as modelSyncExport } from '../versions/v0_2_87/03_model_sync_db_to_json';
import { migration as claudeCodeFableDefault } from '../versions/v0_2_89/03_claude_code_fable_default';
import { migration as agentKindOpencodeToClaudeCode } from '../versions/v0_2_90/01_agent_kind_opencode_to_claude_code';
import type { NodeMigration } from './types';

/** Runnable `node` migrations, keyed by `meta.id`. */
export const NODE_MIGRATIONS: Readonly<Record<string, NodeMigration>> = {
  [gov01.meta.id]: gov01,
  [ssoUnify.meta.id]: ssoUnify,
  [runCodeExport.meta.id]: runCodeExport,
  [modelSyncExport.meta.id]: modelSyncExport,
  [claudeCodeFableDefault.meta.id]: claudeCodeFableDefault,
  [agentKindOpencodeToClaudeCode.meta.id]: agentKindOpencodeToClaudeCode,
};
