'use node';

import { generateObject } from 'ai';
import { v } from 'convex/values';
import { CronExpressionParser } from 'cron-parser';
import { z } from 'zod/v4';

import type { Id } from '../../_generated/dataModel';

import { api } from '../../_generated/api';
import { action } from '../../_generated/server';
import { authComponent } from '../../auth';
import { getEnvOrThrow } from '../../lib/get_or_throw';
import { openai } from '../../lib/openai_provider';

export const generateCronExpression = action({
  args: {
    naturalLanguage: v.string(),
  },
  returns: v.object({
    cronExpression: v.string(),
    description: v.string(),
  }),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const input = args.naturalLanguage.trim();
    if (!input) {
      throw new Error('Please enter a schedule description.');
    }

    const model = getEnvOrThrow('OPENAI_FAST_MODEL');

    const result = await generateObject({
      model: openai(model),
      temperature: 0.1,
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
      system: `You are a cron expression generator. Convert natural language schedule descriptions into standard 5-field cron expressions (minute hour day month weekday).

Rules:
- Output ONLY valid 5-field cron expressions. Do NOT use 6-field or 7-field formats.
- The five fields are: minute (0-59), hour (0-23), day of month (1-31), month (1-12), day of week (0-6, where 0=Sunday).
- Supported special characters: * , - /
- The description must be a concise English explanation regardless of the input language.
- If the input is ambiguous, use the most common interpretation.
- All times are in UTC unless the user specifies otherwise.`,
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

export const createWebhook = action({
  args: {
    organizationId: v.string(),
    workflowRootId: v.id('wfDefinitions'),
  },
  returns: v.object({
    webhookId: v.id('wfWebhooks'),
    token: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ webhookId: Id<'wfWebhooks'>; token: string }> => {
    return await ctx.runMutation(
      api.workflows.triggers.mutations.createWebhook,
      args,
    );
  },
});
