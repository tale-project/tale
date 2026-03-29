/**
 * File-backed workflow data source.
 *
 * Reads workflow definition and steps from a pre-loaded JSON config.
 * Called once at workflow start time only — not per-step.
 * The engine snapshots the data onto the execution record at start.
 */

import type { WorkflowJsonConfig } from '../../../../lib/shared/schemas/workflows';
import type {
  WorkflowDataSource,
  WorkflowDefinition,
  StepDefinition,
} from './types';

export class FileWorkflowDataSource implements WorkflowDataSource {
  constructor(
    private config: WorkflowJsonConfig,
    private workflowSlug: string,
    private organizationId: string,
  ) {}

  async getWorkflowDefinition(): Promise<WorkflowDefinition> {
    return {
      _id: this.workflowSlug,
      organizationId: this.organizationId,
      name: this.config.name,
      description: this.config.description,
      version: this.config.version ?? '1.0.0',
      status: this.config.enabled ? 'active' : 'inactive',
      workflowType: 'predefined',
      config: this.config.config
        ? {
            timeout: this.config.config.timeout,
            retryPolicy: this.config.config.retryPolicy,
            variables: this.config.config.variables,
          }
        : undefined,
    };
  }

  async getStepDefinitions(): Promise<StepDefinition[]> {
    return this.config.steps.map((step, index) => ({
      _id: `${this.workflowSlug}:${step.stepSlug}`,
      organizationId: this.organizationId,
      wfDefinitionId: this.workflowSlug,
      stepSlug: step.stepSlug,
      name: step.name,
      stepType: step.stepType,
      order: step.order ?? index,
      config: step.config,
      nextSteps: step.nextSteps,
    }));
  }

  getOrganizationId(): string {
    return this.organizationId;
  }

  getSourceIdentifier(): string {
    return `file:${this.workflowSlug}`;
  }
}
