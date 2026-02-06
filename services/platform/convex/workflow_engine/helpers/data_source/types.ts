/**
 * Workflow Data Source Types
 */
import type { Id } from '../../../_generated/dataModel';

/**
 * Abstract interface for workflow data sources
 *
 * All workflow execution logic should depend only on this interface,
 * ensuring complete code reuse between different data sources.
 */
export interface WorkflowDataSource {
  /**
   * Get the workflow definition
   */
  getWorkflowDefinition(): Promise<WorkflowDefinition>;

  /**
   * Get all step definitions for this workflow, sorted by order
   */
  getStepDefinitions(): Promise<StepDefinition[]>;

  /**
   * Get the organization ID for this workflow
   */
  getOrganizationId(): string;

  /**
   * Get a unique identifier for this workflow source
   * Used for logging and tracking purposes
   */
  getSourceIdentifier(): string;
}

/**
 * Standardized workflow definition structure
 * Used internally by execution logic regardless of source
 */
export interface WorkflowDefinition {
  _id: Id<'wfDefinitions'> | string;
  organizationId: string;
  name: string;
  description?: string;
  version: string;
  status: 'draft' | 'active' | 'inactive' | 'archived';
  workflowType?: 'predefined'; // Workflow type
  config?: {
    timeout?: number;
    retryPolicy?: {
      maxRetries: number;
      backoffMs: number;
    };
    variables?: Record<string, unknown>;
  };
  metadata?: unknown;
}

/**
 * Standardized step definition structure
 * Used internally by execution logic regardless of source
 */
export interface StepDefinition {
  _id: Id<'wfStepDefs'> | string;
  organizationId: string;
  wfDefinitionId: Id<'wfDefinitions'> | string;
  stepSlug: string;
  name: string;
  stepType: 'start' | 'trigger' | 'llm' | 'condition' | 'action' | 'loop';
  order: number;
  config: unknown;
  nextSteps: Record<string, string>;
}
