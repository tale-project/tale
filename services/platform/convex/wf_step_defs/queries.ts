import { v } from 'convex/values';
import { queryWithRLS } from '../lib/rls';
import { listWorkflowSteps as listWorkflowStepsHelper } from '../workflows/steps/list_workflow_steps';
import { validateStepConfig } from '../workflow_engine/helpers/validation/validate_step_config';
import { validateCircularDependencies } from '../workflow_engine/helpers/validation/circular_dependency_validator';

export const getWorkflowSteps = queryWithRLS({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
  },
  handler: async (ctx, args) => {
    return await listWorkflowStepsHelper(ctx, args);
  },
});

export const validateStep = queryWithRLS({
  args: {
    stepConfig: v.object({
      stepSlug: v.optional(v.string()),
      name: v.optional(v.string()),
      stepType: v.optional(v.string()),
      config: v.optional(v.any()),
    }),
    wfDefinitionId: v.optional(v.id('wfDefinitions')),
  },
  handler: async (ctx, args) => {
    const stepResult = validateStepConfig({
      stepSlug: args.stepConfig.stepSlug,
      name: args.stepConfig.name,
      stepType: args.stepConfig.stepType,
      config: args.stepConfig.config,
    });

    const errors = [...stepResult.errors];
    const warnings = [...stepResult.warnings];

    const defId = args.wfDefinitionId;
    if (defId) {
      const stepsForCircularCheck = [];
      for await (const step of ctx.db
        .query('wfStepDefs')
        .withIndex('by_definition', (q) =>
          q.eq('wfDefinitionId', defId),
        )) {
        stepsForCircularCheck.push({
          stepSlug: step.stepSlug,
          nextSteps: step.nextSteps,
        });
      }

      const circularResult = validateCircularDependencies(
        stepsForCircularCheck,
      );
      errors.push(...circularResult.errors);
      warnings.push(...circularResult.warnings);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  },
});
