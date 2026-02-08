/**
 * Dry-Run Executor
 *
 * Simulates workflow execution without side effects.
 * Traces through the workflow graph and returns the execution path.
 */

import type { Doc } from '../../_generated/dataModel';

type StepType = Doc<'wfStepDefs'>['stepType'];

interface StepDef {
  stepSlug: string;
  name: string;
  stepType: StepType;
  order: number;
  config: Record<string, unknown>;
  nextSteps: Record<string, string>;
}

interface DryRunStepResult {
  stepSlug: string;
  stepType: StepType;
  name: string;
  mocked: boolean;
  wouldExecute: boolean;
  simulatedOutput: unknown;
  nextStep: string | null;
  branch?: string;
}

export interface DryRunResult {
  success: boolean;
  executionPath: string[];
  stepResults: DryRunStepResult[];
  errors: string[];
  warnings: string[];
}

function findStartStep(steps: StepDef[]): StepDef | null {
  return steps.find((s) => s.stepType === 'start' || s.stepType === 'trigger') || null;
}

function findStepBySlug(steps: StepDef[], slug: string): StepDef | null {
  return steps.find((s) => s.stepSlug === slug) || null;
}

function simulateStepOutput(
  step: StepDef,
  _input: unknown,
): {
  output: unknown;
  branch: string;
} {
  switch (step.stepType) {
    case 'start':
    case 'trigger':
      return {
        output: { type: 'start', data: { triggered: true } },
        branch: 'success',
      };

    case 'llm':
      return {
        output: {
          type: 'llm',
          data: { response: '[Simulated LLM response]', mocked: true },
        },
        branch: 'success',
      };

    case 'condition': {
      const expression = typeof step.config.expression === 'string' ? step.config.expression : '';
      return {
        output: {
          type: 'condition',
          data: {
            passed: true,
            expression,
            message: '[Simulated condition - assumed true]',
          },
        },
        branch: 'true',
      };
    }

    case 'action': {
      const actionType = typeof step.config.type === 'string' ? step.config.type : 'unknown';
      return {
        output: {
          type: 'action',
          data: {
            actionType,
            result: '[Simulated action result]',
            mocked: true,
          },
        },
        branch: 'success',
      };
    }

    case 'loop':
      return {
        output: {
          type: 'loop',
          data: {
            state: {
              currentIndex: 0,
              totalItems: 0,
              iterations: 0,
              isComplete: true,
            },
            mocked: true,
          },
        },
        branch: 'done',
      };

    default:
      return {
        output: { type: 'unknown', data: null },
        branch: 'success',
      };
  }
}

export function executeDryRun(
  workflowDef: Doc<'wfDefinitions'>,
  steps: Doc<'wfStepDefs'>[],
  input: unknown = {},
): DryRunResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const executionPath: string[] = [];
  const stepResults: DryRunStepResult[] = [];

  const stepDefs: StepDef[] = steps.map((s) => ({
    stepSlug: s.stepSlug,
    name: s.name,
    stepType: s.stepType,
    order: s.order,
    config: s.config,
    nextSteps: s.nextSteps,
  }));

  const startStep = findStartStep(stepDefs);
  if (!startStep) {
    errors.push('No start step found in workflow');
    return { success: false, executionPath, stepResults, errors, warnings };
  }

  const visited = new Set<string>();
  let currentStep: StepDef | null = startStep;
  let currentInput = input;
  const maxSteps = 100;
  let stepCount = 0;

  while (currentStep && stepCount < maxSteps) {
    stepCount++;

    if (visited.has(currentStep.stepSlug)) {
      warnings.push(
        `Loop detected at step '${currentStep.stepSlug}' - stopping dry run`,
      );
      break;
    }

    visited.add(currentStep.stepSlug);
    executionPath.push(currentStep.stepSlug);

    const { output, branch } = simulateStepOutput(currentStep, currentInput);

    const nextStepSlug = currentStep.nextSteps[branch] || null;
    const isNoop = nextStepSlug === 'noop';

    stepResults.push({
      stepSlug: currentStep.stepSlug,
      stepType: currentStep.stepType,
      name: currentStep.name,
      mocked: true,
      wouldExecute: true,
      simulatedOutput: output,
      nextStep: isNoop ? null : nextStepSlug,
      branch,
    });

    if (!nextStepSlug || isNoop) {
      break;
    }

    const nextStep = findStepBySlug(stepDefs, nextStepSlug);
    if (!nextStep) {
      errors.push(
        `Step '${currentStep.stepSlug}' references non-existent step '${nextStepSlug}'`,
      );
      break;
    }

    currentInput = output;
    currentStep = nextStep;
  }

  if (stepCount >= maxSteps) {
    warnings.push(`Dry run stopped after ${maxSteps} steps (safety limit)`);
  }

  return {
    success: errors.length === 0,
    executionPath,
    stepResults,
    errors,
    warnings,
  };
}
