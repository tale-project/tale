import { v } from 'convex/values';
import type { ActionDefinition } from '../../helpers/nodes/action/types';
import type { WorkflowActionParams } from './helpers/types';
import { uploadAllWorkflows } from './helpers/upload_workflows';

export const workflowAction: ActionDefinition<WorkflowActionParams> = {
  type: 'workflow',
  title: 'Workflow Operations',
  description: 'Execute workflow-related operations (upload_all_workflows)',

  parametersValidator: v.object({
    operation: v.literal('upload_all_workflows'),
    organizationId: v.string(),
    timeout: v.optional(v.number()),
  }),

  async execute(_ctx, params) {
    switch (params.operation) {
      case 'upload_all_workflows': {
        const startTime = Date.now();

        // Upload all workflows to RAG service
        const result = await uploadAllWorkflows(
          params.organizationId,
          params.timeout || 120000,
        );

        // Return result with execution metadata
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
