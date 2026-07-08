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
import { migration as installEmailApps } from '../versions/v0_2_90/03_install_email_apps';
import { migration as dropAgentWorkforcePolicy } from '../versions/v0_2_90/04_drop_agent_workforce_policy';
import { migration as removeWorkforceAgents } from '../versions/v0_2_90/05_remove_workforce_agents';
import { migration as removeRetiredTaskWorkflows } from '../versions/v0_2_90/07_remove_retired_task_workflows';
import { migration as retireIssueDesk } from '../versions/v0_2_92/01_retire_issue_desk';
import { migration as brandingSingleAccentColor } from '../versions/v0_3_4/01_branding_single_accent_color';
import type { NodeMigration } from './types';

/** Runnable `node` migrations, keyed by `meta.id`. */
export const NODE_MIGRATIONS: Readonly<Record<string, NodeMigration>> = {
  [gov01.meta.id]: gov01,
  [ssoUnify.meta.id]: ssoUnify,
  [runCodeExport.meta.id]: runCodeExport,
  [modelSyncExport.meta.id]: modelSyncExport,
  [claudeCodeFableDefault.meta.id]: claudeCodeFableDefault,
  [agentKindOpencodeToClaudeCode.meta.id]: agentKindOpencodeToClaudeCode,
  [brandingSingleAccentColor.meta.id]: brandingSingleAccentColor,
  [installEmailApps.meta.id]: installEmailApps,
  [dropAgentWorkforcePolicy.meta.id]: dropAgentWorkforcePolicy,
  [removeWorkforceAgents.meta.id]: removeWorkforceAgents,
  [removeRetiredTaskWorkflows.meta.id]: removeRetiredTaskWorkflows,
  [retireIssueDesk.meta.id]: retireIssueDesk,
};
