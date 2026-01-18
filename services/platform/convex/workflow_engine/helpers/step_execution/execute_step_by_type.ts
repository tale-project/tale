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
  /**
   * Build minimal steps metadata to avoid exceeding Convex's 16 MiB argument limit.
   * Full step outputs are excluded since template variables are already resolved
   * before executeStepByType is called (see execute_step_handler.ts).
   */
  function buildMinimalSteps(
    steps: Record<string, unknown>,
  ): Record<string, unknown> {
    const minimal: Record<string, unknown> = {};
    for (const [slug, step] of Object.entries(steps)) {
      if (step && typeof step === 'object') {
        const s = step as Record<string, unknown>;
        minimal[slug] = {
          stepType: s.stepType,
          name: s.name,
          hasOutput: s.output !== undefined,
          // Exclude full output to prevent argument size overflow
        };
      }
    }
    return minimal;
  }

  function buildVariablesForAction(
    variables: Record<string, unknown>,
  ): Record<string, unknown> {
    const maxLoopDepth = 8;

    function trimLoop(loopVar: unknown, depth: number): unknown {
      if (!loopVar || typeof loopVar !== 'object') return loopVar;
      if (depth >= maxLoopDepth) {
        const loopObj = loopVar as Record<string, unknown>;
        const { parent: _parent, ...rest } = loopObj;
        return { ...rest, parent: undefined };
      }
      const loopObj = loopVar as Record<string, unknown>;
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(loopObj)) {
        if (k === 'parent') {
          result.parent = trimLoop(v, depth + 1);
        } else {
          result[k] = v;
        }
      }
      return result;
    }

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(variables)) {
      if (key === 'loop') {
        result.loop = trimLoop(value, 0);
      } else if (key === 'steps') {
        // Pass only step metadata, not full outputs, to stay under 16 MiB limit
        result.steps = buildMinimalSteps(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  // Type alias for variables compatible with Convex validators
  type JsonVariables = Record<string, string | number | boolean | (string | number | boolean | (string | number | boolean | null)[] | Record<string, string | number | boolean | null> | null)[] | Record<string, string | number | boolean | null> | null>;

  switch (stepDef.stepType) {
    case 'trigger':
      return await ctx.runAction(internal.workflow_engine.nodes.executeTriggerNode, {
        stepDef: {
          stepSlug: stepDef.stepSlug,
          stepType: 'trigger' as const,
          config: { type: 'manual' },
        },
        variables: variables as JsonVariables,
        executionId,
        threadId,
      });

    case 'llm':
      // Config is validated at runtime by the handler's llmStepConfigValidator
      return await ctx.runAction(internal.workflow_engine.nodes.executeLLMNode, {
        stepDef: {
          stepSlug: stepDef.stepSlug,
          stepType: 'llm' as const,
          config: stepDef.config as Infer<typeof llmStepConfigValidator>,
          organizationId: stepDef.organizationId,
        },
        variables: variables as JsonVariables,
        executionId,
        threadId, // Pass shared threadId for agent orchestration workflows
      });

    case 'condition':
      return await ctx.runAction(internal.workflow_engine.nodes.executeConditionNode, {
        stepDef: {
          stepSlug: stepDef.stepSlug,
          stepType: 'condition' as const,
          config: stepDef.config as { expression: string },
        },
        variables: variables as JsonVariables,
        executionId,
      });

    case 'action': {
      const trimmedVariables = buildVariablesForAction(variables);
      return await ctx.runAction(internal.workflow_engine.nodes.executeActionNode, {
        stepDef: {
          stepSlug: stepDef.stepSlug,
          stepType: 'action' as const,
          config: stepDef.config as { type: string; parameters: Record<string, JsonVariables[string]>; retryPolicy?: { maxRetries: number; backoffMs: number } },
        },
        variables: trimmedVariables as JsonVariables,
        executionId,
        threadId,
      });
    }

    case 'loop':
      return await ctx.runAction(internal.workflow_engine.nodes.executeLoopNode, {
        stepDef: {
          stepSlug: stepDef.stepSlug,
          stepType: 'loop' as const,
          config: stepDef.config as { collection: string; itemVariable: string; indexVariable?: string; maxIterations?: number; parallelism?: number },
        },
        variables: variables as JsonVariables,
        executionId,
        threadId,
      });

    default: {
      const _exhaustiveCheck: never = stepDef.stepType as never;
      throw new Error(`Unknown step type: ${_exhaustiveCheck}`);
    }
  }
}
