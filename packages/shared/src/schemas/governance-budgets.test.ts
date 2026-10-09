/**
 * The budgets file is read by every image in a rolling deploy, including
 * one from before project caps existed. That reader must still parse a file
 * that holds them and keep enforcing every other cap: a file it cannot
 * parse reads as no policy at all, so a project cap must never sit where it
 * would fail the parse.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';

import {
  allBudgetRules,
  budgetConfigOf,
  budgetConfigSchema,
  type BudgetRule,
} from './governance';

/** The schema as it stood before project caps — a verbatim copy. */
const previousSchema = z.object({
  rules: z.array(
    z.object({
      scope: z.enum(['user', 'team', 'role', 'org', 'default', 'apiKey']),
      scopeId: z.string().optional(),
      apiKeyId: z.string().optional(),
      period: z.enum(['daily', 'weekly', 'monthly']),
      maxTokens: z.number().nonnegative().optional(),
      maxCostCents: z.number().nonnegative().optional(),
      maxRequests: z.number().nonnegative().optional(),
      warningThresholdPercent: z.number().min(0).max(100).optional(),
    }),
  ),
  enabled: z.boolean(),
});

const RULES: BudgetRule[] = [
  { scope: 'default', period: 'monthly', maxCostCents: 5_000 },
  {
    scope: 'project',
    scopeId: 'project-1',
    period: 'monthly',
    maxCostCents: 20_000,
    warningThresholdPercent: 80,
  },
  { scope: 'apiKey', apiKeyId: 'key-1', period: 'daily', maxRequests: 100 },
];

describe('the budgets file with project caps', () => {
  it('keeps a project’s cap out of `rules`, where an older reader would fail the file', () => {
    const file = budgetConfigOf(true, RULES);
    expect(file).toEqual({
      enabled: true,
      rules: [RULES[0], RULES[2]],
      projectRules: [RULES[1]],
    });
    const parsed = previousSchema.safeParse(file);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.rules).toEqual([RULES[0], RULES[2]]);
    expect(parsed.data).not.toHaveProperty('projectRules');
  });

  it('refuses a project scope inside `rules`', () => {
    expect(
      budgetConfigSchema.safeParse({ enabled: true, rules: [RULES[1]] })
        .success,
    ).toBe(false);
  });

  it('reads both kinds of rule back as one list', () => {
    const parsed = budgetConfigSchema.parse(budgetConfigOf(true, RULES));
    expect(allBudgetRules(parsed)).toEqual([RULES[0], RULES[2], RULES[1]]);
  });

  it('writes no `projectRules` when no rule caps a project', () => {
    expect(budgetConfigOf(false, [RULES[0]])).toEqual({
      enabled: false,
      rules: [RULES[0]],
    });
  });

  it('refuses a project cap that names no project', () => {
    expect(
      budgetConfigSchema.safeParse({
        enabled: true,
        rules: [],
        projectRules: [{ scope: 'project', scopeId: '', period: 'daily' }],
      }).success,
    ).toBe(false);
  });
});
