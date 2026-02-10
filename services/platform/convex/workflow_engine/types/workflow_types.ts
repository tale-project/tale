/**
 * Workflow Type Constants and Helpers
 *
 * This module defines workflow types and helpers for predefined workflows.
 */

import type { WorkflowType } from './workflow';

// =============================================================================
// WORKFLOW TYPE CONSTANTS
// =============================================================================

/**
 * Predefined Workflows
 *
 * These workflows are predefined by developers and can include various operations
 * such as data syncing, cleaning, LLM processing, agent tasks, etc.
 *
 * Characteristics:
 * - Always predefined by developers
 * - Users can't create their own, but can choose which ones to use
 * - Users provide their credentials
 * - Can include any node types (action, LLM, agent, condition, loop, etc.)
 * - No shared thread context (each LLM/agent step creates its own thread)
 */
export const WORKFLOW_TYPE_PREDEFINED: WorkflowType = 'predefined';

// =============================================================================
// PREDEFINED WORKFLOW KEYS
// =============================================================================

/**
 * List of predefined workflow keys
 * These are the only predefined workflows that can be created
 */
export const PREDEFINED_WORKFLOWS = [
  'shopify-sync-products',
  'shopify-sync-customers',
  'circuly-sync-customers',
  'circuly-sync-products',
  'circuly-sync-subscriptions',
  'email-sync-imap',
  'email-sync-sent-imap',
  'website-scan',
] as const;

export type PredefinedWorkflow = (typeof PREDEFINED_WORKFLOWS)[number];

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if a workflow is a predefined workflow
 */
export function isPredefinedWorkflow(workflowType: WorkflowType): boolean {
  return workflowType === WORKFLOW_TYPE_PREDEFINED;
}

/**
 * Check if a workflow name is a predefined workflow
 */
export function isPredefinedWorkflowName(workflowName: string): boolean {
  return PREDEFINED_WORKFLOWS.some((w) => w === workflowName);
}

/**
 * Validate that a workflow type matches its name
 * Predefined workflows must use predefined names
 */
export function validateWorkflowTypeAndName(
  workflowType: WorkflowType,
  workflowName: string,
): { valid: boolean; error?: string } {
  if (workflowType === WORKFLOW_TYPE_PREDEFINED) {
    if (!isPredefinedWorkflowName(workflowName)) {
      return {
        valid: false,
        error: `Predefined workflows must use one of the predefined names: ${PREDEFINED_WORKFLOWS.join(', ')}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Get workflow type description
 */
export function getWorkflowTypeDescription(workflowType: WorkflowType): string {
  switch (workflowType) {
    case WORKFLOW_TYPE_PREDEFINED:
      return 'Predefined - Developer-defined workflows for platform integrations and data operations';
    default:
      return 'Unknown workflow type';
  }
}
