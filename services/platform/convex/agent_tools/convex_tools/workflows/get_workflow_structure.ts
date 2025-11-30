/**
 * Convex Tool: Get Workflow Structure
 *
 * Retrieves complete workflow structure including all steps for AI analysis
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolDefinition } from '../../types';
import type { Doc, Id } from '../../../_generated/dataModel';
import { internal } from '../../../_generated/api';

export const getWorkflowStructureTool = {
  name: 'get_workflow_structure' as const,
  tool: createTool({
    description:
      'Get the complete structure of a workflow including workflow metadata and all steps. Use this to understand the current workflow before making modifications.',
    args: z.object({
      workflowId: z
        .string()
        .describe('The workflow ID (Convex Id<"wfDefinitions">)'),
    }),
    handler: async (
      ctx,
      args,
    ): Promise<{
      workflow: Doc<'wfDefinitions'> | null;
      steps: Doc<'wfStepDefs'>[];
    }> => {
      const workflowId = args.workflowId as Id<'wfDefinitions'>;

      // Get workflow definition
      const workflow = await ctx.runQuery(internal.wf_definitions.getWorkflow, {
        wfDefinitionId: workflowId,
      });

      if (!workflow) {
        return { workflow: null, steps: [] };
      }

      // Get all steps for this workflow
      const steps = await ctx.runQuery(
        internal.wf_step_defs.listWorkflowSteps,
        {
          wfDefinitionId: workflowId,
        },
      );

      return {
        workflow: workflow as Doc<'wfDefinitions'>,
        steps: steps as Doc<'wfStepDefs'>[],
      };
    },
  }),
} as const satisfies ToolDefinition;

