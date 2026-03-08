/**
 * Execute step by type using strategy pattern
 */

import type { Infer } from 'convex/values';

import type {
  ActionNodeConfig,
  llmStepConfigValidator,
} from '../../types/nodes';

import { isRecord } from '../../../../lib/utils/type-guards';
import { internal } from '../../../_generated/api';
import { ActionCtx } from '../../../_generated/server';
import { replaceVariables } from '../../../lib/variables/replace_variables';
import { StepDefinition, StepExecutionResult } from './types';

export async function executeStepByType(
  ctx: ActionCtx,
  stepDef: StepDefinition,
  variables: Record<string, unknown>,
  executionId: string,
  threadId?: string,
): Promise<StepExecutionResult> {
  switch (stepDef.stepType) {
    case 'start':
    case 'trigger':
      return {
        port: 'success',
        output: {
          type: 'start',
          data: 'Workflow started',
        },
        threadId,
      };

    case 'llm':
      return await ctx.runAction(
        internal.workflow_engine.internal_actions.executeLLMNode,
        {
          stepDef: {
            stepSlug: stepDef.stepSlug,
            stepType: 'llm' as const,
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- step config shape validated at runtime by Convex validators
            config: stepDef.config as Infer<typeof llmStepConfigValidator>,
            organizationId: stepDef.organizationId,
          },
          variables,
          executionId,
          threadId,
        },
      );

    case 'condition':
      return await ctx.runAction(
        internal.workflow_engine.internal_actions.executeConditionNode,
        {
          stepDef: {
            stepSlug: stepDef.stepSlug,
            stepType: 'condition' as const,
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- step config shape validated at runtime by Convex validators
            config: stepDef.config as { expression: string },
          },
          variables,
          executionId,
        },
      );

    case 'action':
      return await ctx.runAction(
        internal.workflow_engine.internal_actions.executeActionNode,
        {
          stepDef: {
            stepSlug: stepDef.stepSlug,
            stepType: 'action' as const,
            // Dynamic config shape validated at runtime by action executor
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- step config shape validated at runtime by action executor; double cast needed because Record<string, unknown> doesn't overlap with ActionNodeConfig
            config: stepDef.config as unknown as ActionNodeConfig,
          },
          variables,
          executionId,
          threadId,
        },
      );

    case 'loop':
      return await ctx.runAction(
        internal.workflow_engine.internal_actions.executeLoopNode,
        {
          stepDef: {
            stepSlug: stepDef.stepSlug,
            stepType: 'loop' as const,
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- step config shape validated at runtime by Convex validators
            config: stepDef.config as {
              collection: string;
              itemVariable: string;
              indexVariable?: string;
              maxIterations?: number;
              parallelism?: number;
            },
          },
          variables,
          executionId,
          threadId,
        },
      );

    case 'output': {
      const mapping = isRecord(stepDef.config)
        ? stepDef.config.outputMapping
        : undefined;
      let mappedOutput: unknown = null;
      if (isRecord(mapping) && Object.keys(mapping).length > 0) {
        try {
          mappedOutput = replaceVariables(mapping, variables);
        } catch {
          // Bad output mapping template should not fail the workflow
          mappedOutput = null;
        }
      }
      return {
        port: 'success',
        output: { type: 'output', data: mappedOutput },
        variables: { __workflowOutput: mappedOutput },
      };
    }

    default: {
      const _exhaustiveCheck: never = stepDef.stepType;
      throw new Error(`Unknown step type: ${String(_exhaustiveCheck)}`);
    }
  }
}
