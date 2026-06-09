'use node';

import { generateObject } from 'ai';
import { v } from 'convex/values';
import { CronExpressionParser } from 'cron-parser';
import { z } from 'zod/v4';

import { action } from '../../_generated/server';
import { reasoningProviderOptionsFor } from '../../lib/agent_response/reasoning/build_reasoning_options';
import { requireOrgMembershipById } from '../../lib/auth/require_org_membership';
import { renderPrompt } from '../../lib/prompts/registry';
import { buildCallProviderOptions } from '../../lib/provider_options';
import { resolveLanguageModelWithFallback } from '../../providers/failover';

export const generateCronExpression = action({
  args: {
    naturalLanguage: v.string(),
    organizationId: v.string(),
  },
  returns: v.object({
    cronExpression: v.string(),
    description: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ cronExpression: string; description: string }> => {
    const input = args.naturalLanguage.trim();
    if (!input) {
      throw new Error('Please enter a schedule description.');
    }

    await requireOrgMembershipById(ctx, args.organizationId);

    // Resolve chat model from provider files
    const { languageModel, modelData } = await resolveLanguageModelWithFallback(
      ctx,
      {
        tag: 'chat',
        organizationId: args.organizationId,
      },
    );
    // Cron generation is a small structured task — force minimal reasoning.
    const callProviderOptions = reasoningProviderOptionsFor(
      modelData,
      buildCallProviderOptions(modelData),
      { kind: 'utility' },
    );

    const result = await generateObject({
      model: languageModel,
      temperature: 0.1,
      ...(callProviderOptions ? { providerOptions: callProviderOptions } : {}),
      schema: z.object({
        cronExpression: z
          .string()
          .describe(
            'A valid 5-field cron expression (minute hour day month weekday)',
          ),
        description: z
          .string()
          .describe(
            'A short human-readable English description of the schedule',
          ),
      }),
      system: renderPrompt('cron.generator'),
      prompt: input,
    });

    try {
      CronExpressionParser.parse(result.object.cronExpression);
    } catch {
      throw new Error('Generated schedule was invalid. Please try again.');
    }

    return {
      cronExpression: result.object.cronExpression,
      description: result.object.description,
    };
  },
});
