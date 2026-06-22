/**
 * Workflow Data Source Types
 */

/**
 * Workflow step type discriminant. Mirrors the step configs in
 * `workflow_engine/types/nodes.ts`. Declared standalone here so workflow
 * execution types no longer depend on the dropped `wfStepDefs` table doc.
 */
export type StepType =
  | 'start'
  | 'trigger'
  | 'llm'
  | 'condition'
  | 'action'
  | 'loop'
  | 'output'
  | 'sandbox';

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
  _id: string;
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
    /**
     * Workflow-level fallback chain inherited by every LLM step that defines
     * neither `model` nor `models`. Step-level overrides win.
     */
    models?: string[];
  };
  metadata?: unknown;
}

/**
 * Standardized step definition structure
 * Used internally by execution logic regardless of source
 */
export interface StepDefinition {
  _id: string;
  organizationId: string;
  wfDefinitionId: string;
  stepSlug: string;
  name: string;
  stepType: StepType;
  order: number;
  config: unknown;
  nextSteps: Record<string, string>;
}
