/**
 * Execute step by type using strategy pattern
 */

import { ActionCtx } from '../../../_generated/server';
import { internal } from '../../../_generated/api';
import { StepDefinition, StepExecutionResult } from './types';
import type { Infer } from 'convex/values';
import type { llmStepConfigValidator } from '../../types/nodes';

export async function executeStepByType(
  ctx: ActionCtx,
  stepDef: StepDefinition,
  variables: Record<string, unknown>,
  executionId: string,
  threadId?: string,
): Promise<StepExecutionResult> {
  switch (stepDef.stepType) {
    case 'start':
      return await ctx.runAction(internal.workflow_engine.nodes.executeStartNode, {
        stepDef: {
          stepSlug: stepDef.stepSlug,
          stepType: 'start' as const,
          config: {},
        },
        variables,
        executionId,
        threadId,
      });

    case 'trigger':
      return await ctx.runAction(internal.workflow_engine.internal_actions.executeTriggerNode, {
        stepDef: {
          stepSlug: stepDef.stepSlug,
          stepType: 'trigger' as const,
          config: { type: 'manual' },
        },
        variables,
        executionId,
        threadId,
      });

    case 'llm':
      return await ctx.runAction(internal.workflow_engine.internal_actions.executeLLMNode, {
        stepDef: {
          stepSlug: stepDef.stepSlug,
          stepType: 'llm' as const,
          config: stepDef.config as Infer<typeof llmStepConfigValidator>,
          organizationId: stepDef.organizationId,
        },
        variables,
        executionId,
        threadId,
      });

    case 'condition':
      return await ctx.runAction(internal.workflow_engine.internal_actions.executeConditionNode, {
        stepDef: {
          stepSlug: stepDef.stepSlug,
          stepType: 'condition' as const,
          config: stepDef.config as { expression: string },
        },
        variables,
        executionId,
      });

    case 'action':
      return await ctx.runAction(internal.workflow_engine.internal_actions.executeActionNode, {
        stepDef: {
          stepSlug: stepDef.stepSlug,
          stepType: 'action' as const,
          config: stepDef.config as any,
        },
        variables,
        executionId,
        threadId,
      });

    case 'loop':
      return await ctx.runAction(internal.workflow_engine.internal_actions.executeLoopNode, {
        stepDef: {
          stepSlug: stepDef.stepSlug,
          stepType: 'loop' as const,
          config: stepDef.config as { collection: string; itemVariable: string; indexVariable?: string; maxIterations?: number; parallelism?: number },
        },
        variables,
        executionId,
        threadId,
      });

    default: {
      const _exhaustiveCheck: never = stepDef.stepType as never;
      throw new Error(`Unknown step type: ${_exhaustiveCheck}`);
    }
  }
}
