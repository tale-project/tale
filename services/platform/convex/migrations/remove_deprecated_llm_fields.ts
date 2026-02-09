/**
 * Migration: Remove deprecated LLM config fields from workflow step definitions.
 *
 * These fields are no longer configurable in workflow definitions:
 * - temperature: auto-determined based on outputFormat (json→0.2, text→0.5)
 * - maxTokens: uses model's default value
 * - maxSteps: defaults to 40 when tools are configured
 *
 * Run this migration once after deploying the updated schema.
 *
 * Usage:
 *   npx convex run migrations/remove_deprecated_llm_fields:removeDeprecatedLLMFields
 */

import { internalMutation } from '../_generated/server';

export const removeDeprecatedLLMFields = internalMutation({
  args: {},
  handler: async (ctx) => {
    const steps = await ctx.db.query('wfStepDefs').collect();
    let updated = 0;
    const details: Array<{
      stepId: string;
      stepSlug: string;
      removed: string[];
    }> = [];

    for (const step of steps) {
      if (step.stepType !== 'llm' || !step.config) {
        continue;
      }

      const config = step.config as Record<string, unknown>;
      const deprecatedFields = ['temperature', 'maxTokens', 'maxSteps'];
      const fieldsToRemove = deprecatedFields.filter(
        (field) => field in config,
      );

      if (fieldsToRemove.length === 0) {
        continue;
      }

      const {
        temperature: _temperature,
        maxTokens: _maxTokens,
        maxSteps: _maxSteps,
        ...cleanConfig
      } = config;
      await ctx.db.patch(step._id, { config: cleanConfig });
      updated++;
      details.push({
        stepId: step._id,
        stepSlug: step.stepSlug,
        removed: fieldsToRemove,
      });
    }

    return {
      totalSteps: steps.length,
      llmSteps: steps.filter((s) => s.stepType === 'llm').length,
      updated,
      details,
    };
  },
});
