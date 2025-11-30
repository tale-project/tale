import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolDefinition } from '../../types';
import { validateWorkflowSteps } from '../../../workflow/helpers/engine/validate_workflow_steps';
import { validateStepConfig } from '../../../workflow/helpers/validation/validate_step_config';

/**
 * Validate Workflow Definition Tool
 *
 * Validates a workflow definition structure before saving.
 * Checks:
 * - Valid stepTypes (trigger, llm, action, condition, loop)
 * - Required fields for each step type
 * - Valid nextSteps references
 * - Config structure for each step type
 */
export const validateWorkflowDefinitionTool = {
  name: 'validate_workflow_definition',
  tool: createTool({
    description:
      'Validate a workflow definition structure before saving. Returns validation errors if any.',
    args: z.object({
      workflowDefinition: z.object({
        workflowConfig: z.record(z.string(), z.unknown()),
        stepsConfig: z.array(z.record(z.string(), z.unknown())),
      }),
    }),
    handler: async (_ctx, args) => {
      const errors: string[] = [];
      const warnings: string[] = [];
      const def = args.workflowDefinition as {
        workflowConfig: Record<string, unknown>;
        stepsConfig: Array<Record<string, unknown>>;
      };

      // Validate workflow config structure
      if (!def.workflowConfig || typeof def.workflowConfig !== 'object') {
        errors.push('Workflow config is required and must be an object');
      } else if (
        !def.workflowConfig.name ||
        typeof def.workflowConfig.name !== 'string'
      ) {
        errors.push('Workflow config must have a "name" field (string)');
      }

      // Validate steps array
      if (!Array.isArray(def.stepsConfig)) {
        errors.push('stepsConfig must be an array');
        return { valid: false, errors, warnings };
      }

      const validStepTypes = ['trigger', 'llm', 'action', 'condition', 'loop'];

      // Validate each step
      for (let i = 0; i < def.stepsConfig.length; i++) {
        const step = def.stepsConfig[i];
        const stepPrefix = `Step ${i + 1} (${(step as { stepSlug?: string }).stepSlug || 'unknown'}):`;

        // Validate basic step structure
        if (!step || typeof step !== 'object') {
          errors.push(`${stepPrefix} Step must be an object`);
          continue;
        }

        // Validate fields that are not covered by validateStepConfig
        if (typeof (step as { order?: unknown }).order !== 'number') {
          errors.push(
            `${stepPrefix} Missing or invalid "order" field (must be number)`,
          );
        }

        if (
          !(step as { nextSteps?: unknown }).nextSteps ||
          typeof (step as { nextSteps?: unknown }).nextSteps !== 'object'
        ) {
          errors.push(
            `${stepPrefix} Missing or invalid "nextSteps" field (must be object)`,
          );
        }

        // Delegate step-level validation (stepSlug, name, stepType, config, type-specific rules)
        const stepValidation = validateStepConfig({
          stepSlug:
            typeof (step as { stepSlug?: unknown }).stepSlug === 'string'
              ? ((step as { stepSlug?: unknown }).stepSlug as string)
              : undefined,
          name:
            typeof (step as { name?: unknown }).name === 'string'
              ? ((step as { name?: unknown }).name as string)
              : undefined,
          stepType:
            typeof (step as { stepType?: unknown }).stepType === 'string'
              ? ((step as { stepType?: unknown }).stepType as string)
              : undefined,
          config: (step as { config?: unknown }).config,
        });

        if (!stepValidation.valid) {
          for (const message of stepValidation.errors) {
            errors.push(`${stepPrefix} ${message}`);
          }
        }

        // Additional warnings that depend on validStepTypes
        const config = (step as { config?: unknown }).config as
          | Record<string, unknown>
          | undefined;
        if (
          (step as { stepType?: unknown }).stepType === 'action' &&
          config &&
          typeof config === 'object' &&
          'type' in config
        ) {
          const actionType = config.type as string;
          if (validStepTypes.includes(actionType)) {
            warnings.push(
              `${stepPrefix} Action type "${actionType}" matches a stepType name. Did you mean stepType: "${actionType}"?`,
            );
          }
        }
      }

      // Validate nextSteps references
      try {
        validateWorkflowSteps(
          def.stepsConfig as Array<{
            stepSlug: string;
            name: string;
            nextSteps?: Record<string, string>;
          }>,
        );
      } catch (e) {
        errors.push(
          `Invalid nextSteps references: ${e instanceof Error ? e.message : String(e)}`,
        );
      }

      // Check for trigger step
      const hasTrigger = def.stepsConfig.some(
        (step) => step.stepType === 'trigger',
      );
      if (!hasTrigger) {
        warnings.push(
          'No trigger step found. Workflows should start with a trigger step.',
        );
      }

      return {
        valid: errors.length === 0,
        errors,
        warnings,
      };
    },
  }),
} as const satisfies ToolDefinition;
