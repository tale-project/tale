/**
 * Database-backed workflow data source
 *
 * Reads workflow and step definitions from the database.
 * This wraps the existing database access logic.
 */
import type { Id, Doc } from '../../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../_generated/server';
import { internal } from '../../../_generated/api';
import type {
  WorkflowDataSource,
  WorkflowDefinition,
  StepDefinition,
} from './types';

export class DatabaseWorkflowDataSource implements WorkflowDataSource {
  constructor(
    private ctx: MutationCtx | QueryCtx,
    private wfDefinitionId: Id<'wfDefinitions'>,
    private organizationId: string,
  ) {}

  async getWorkflowDefinition(): Promise<WorkflowDefinition> {
    const workflow = (await this.ctx.db.get(
      this.wfDefinitionId,
    )) as Doc<'wfDefinitions'> | null;
    if (!workflow) {
      throw new Error(`Workflow definition not found: ${this.wfDefinitionId}`);
    }

    // Return in standardized format
    return {
      _id: workflow._id,
      organizationId: workflow.organizationId,
      name: workflow.name,
      description: workflow.description,
      version: workflow.version,
      status: workflow.status as WorkflowDefinition['status'],
      workflowType: workflow.workflowType as WorkflowDefinition['workflowType'],
      config: workflow.config,
      metadata: workflow.metadata,
    };
  }

  async getStepDefinitions(): Promise<StepDefinition[]> {
    const steps = (await this.ctx.runQuery(
      internal.wf_step_defs.queries.getOrderedSteps,
      { wfDefinitionId: this.wfDefinitionId },
    )) as Array<Doc<'wfStepDefs'>>;

    // Return in standardized format (already sorted by order from getOrderedSteps)
    return steps.map((step) => ({
      _id: step._id,
      organizationId: step.organizationId,
      wfDefinitionId: step.wfDefinitionId,
      stepSlug: step.stepSlug,
      name: step.name,
      stepType: step.stepType as StepDefinition['stepType'],
      order: step.order,
      config: step.config,
      nextSteps: step.nextSteps as StepDefinition['nextSteps'],
    }));
  }

  getOrganizationId(): string {
    return this.organizationId;
  }

  getSourceIdentifier(): string {
    return `database:${this.wfDefinitionId}`;
  }
}
