import type { ActionDefinition } from '../helpers/nodes/action/types';
import { customerAction } from './customer/customer_action';
import { conversationAction } from './conversation/conversation_action';
import { productAction } from './product/product_action';
import { documentAction } from './document/document_action';
import { setVariablesAction } from './set_variables_action';
import { ragAction } from './rag/rag_action';
import { imapAction } from './imap/imap_action';
import { emailProviderAction } from './email_provider/email_provider_action';
import { workflowProcessingRecordsAction } from './workflow_processing_records/workflow_processing_records_action';
import { approvalAction } from './approval/approval_action';
import { toneOfVoiceAction } from './tone_of_voice/tone_of_voice_action';
import { integrationAction } from './integration/integration_action';
import { onedriveAction } from './onedrive/onedrive_action';
import { crawlerAction } from './crawler/crawler_action';
import { websiteAction } from './website/website_action';
import { websitePagesAction } from './websitePages/websitePages_action';
import { workflowAction } from './workflow/workflow_action';

// =============================================================================
// ACTION REGISTRY
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyActionDefinition = ActionDefinition<any>;

// Array-based registry for iteration (e.g., listing all actions)
export const ACTIONS: AnyActionDefinition[] = [
  customerAction,
  conversationAction,
  productAction,
  documentAction,
  integrationAction, // Unified integration action (credentials + plugin execution)
  setVariablesAction,
  ragAction,
  imapAction,
  emailProviderAction,
  workflowProcessingRecordsAction,
  approvalAction,
  toneOfVoiceAction,
  onedriveAction,
  crawlerAction,
  websiteAction,
  websitePagesAction,
  workflowAction,
];

// Map for O(1) lookups by type
export const ACTIONS_MAP: Record<string, AnyActionDefinition> =
  Object.fromEntries(ACTIONS.map((action) => [action.type, action]));

/**
 * Get an action by type
 */
export function getAction(type: string): ActionDefinition<unknown> | undefined {
  return ACTIONS_MAP[type];
}

/**
 * List all action types
 */
export function listActionTypes(): string[] {
  return ACTIONS.map((action) => action.type);
}
