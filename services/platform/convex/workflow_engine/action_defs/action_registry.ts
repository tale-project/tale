import type { ActionCtx } from '../../_generated/server';
import { agentAction } from './agent/agent_action';
import { approvalAction } from './approval/approval_action';
import { contactAction } from './contact/contact_action';
import { conversationAction } from './conversation/conversation_action';
import { crawlerAction } from './crawler/crawler_action';
import { discussionAction } from './discussion/discussion_action';
import { documentAction } from './document/document_action';
import { integrationAction } from './integration/integration_action';
import { integrationProcessingRecordsAction } from './integration_processing_records/integration_processing_records_action';
import { metricsAction } from './metrics/metrics_action';
import { notificationAction } from './notification/notification_action';
import { onedriveAction } from './onedrive/onedrive_action';
import { productAction } from './product/product_action';
import { projectAction } from './project/project_action';
import { ragAction } from './rag/rag_action';
import { setVariablesAction } from './set_variables_action';
import { taskAction } from './task/task_action';
import { websiteAction } from './website/website_action';
import { workflowProcessingRecordsAction } from './workflow_processing_records/workflow_processing_records_action';

// =============================================================================
// ACTION REGISTRY
// =============================================================================

// Structural base type for the registry — uses method syntax for execute to enable bivariant
// parameter checking, avoiding contravariance issues with ActionDefinition<T>'s typed params
interface AnyActionDefinition {
  type: string;
  parametersValidator?: unknown;
  title?: string;
  description?: string;
  execute(
    ctx: ActionCtx,
    params: unknown,
    variables: Record<string, unknown>,
    extras?: { executionId?: string; stepSlug?: string },
  ): Promise<unknown>;
}

// Array-based registry for iteration (e.g., listing all actions)
export const ACTIONS: AnyActionDefinition[] = [
  contactAction,
  conversationAction,
  productAction,
  projectAction,
  discussionAction,
  documentAction,
  integrationAction, // Unified integration action (credentials + plugin execution)
  setVariablesAction,
  ragAction,
  workflowProcessingRecordsAction,
  integrationProcessingRecordsAction, // Incremental processing of external integration data sources
  approvalAction,
  onedriveAction,
  crawlerAction,
  websiteAction,
  taskAction,
  agentAction, // Run org agents against tasks (task-ops automation pack)
  notificationAction, // Inbox / org-bell fan-out from automations
  metricsAction, // Read-only task/agent-run aggregates
];

// Map for O(1) lookups by type
export const ACTIONS_MAP: Record<string, AnyActionDefinition> =
  Object.fromEntries(ACTIONS.map((action) => [action.type, action]));

/**
 * Get an action by type
 */
export function getAction(type: string): AnyActionDefinition | undefined {
  return ACTIONS_MAP[type];
}

/**
 * List all action types
 */
export function listActionTypes(): string[] {
  return ACTIONS.map((action) => action.type);
}
