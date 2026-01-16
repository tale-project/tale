import { v } from 'convex/values';
import type { ActionDefinition } from '../../helpers/nodes/action/types';
import type { WorkflowActionParams } from './helpers/types';
import { uploadAllWorkflows } from './helpers/upload_workflows';

export const workflowAction: ActionDefinition<WorkflowActionParams> = {
  type: 'workflow',
  title: 'Workflow Operations',
  description:
    'Execute workflow-related operations (upload_all_workflows). organizationId is automatically read from workflow context variables.',

  parametersValidator: v.union(
    // upload_all_workflows: Upload all workflows to RAG service
    v.object({
      operation: v.literal('upload_all_workflows'),
      timeout: v.optional(v.number()),
    }),
  ),

  async execute(_ctx, params, variables) {
    // Read and validate organizationId from workflow context variables
    const organizationId = variables?.organizationId;

    if (typeof organizationId !== 'string' || !organizationId) {
      throw new Error(
        'workflow requires a non-empty string organizationId in workflow context',
      );
    }

    switch (params.operation) {
      case 'upload_all_workflows': {

        const startTime = Date.now();

        // Upload all workflows to RAG service
        const result = await uploadAllWorkflows(
          organizationId,
          params.timeout || 120000,
        );

        // Return result with execution metadata
        // Note: execute_action_node wraps this in output: { type: 'action', data: result }
        return {
          ...result,
          executionTimeMs: Date.now() - startTime,
        };
      }

      default:
        throw new Error(
          `Unsupported workflow operation: ${(params as { operation: string }).operation}`,
        );
    }
  },
};
