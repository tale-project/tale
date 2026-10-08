/**
 * The budgets file is read by every image in a rolling deploy, including
 * one from before project caps existed. That reader must still parse the
 * file and keep enforcing every other cap: a file it cannot parse reads as
 * no policy at all, so a project cap must never sit where it would fail the
 * parse. Project caps live in a file of their own, which such an image
 * never writes; the copy an earlier release kept in the budgets file is
 * read only until that file exists.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';

import {
  allBudgetRules,
  budgetConfigSchema,
  budgetFilesOf,
  type BudgetRule,
  effectiveBudgetConfig,
  projectBudgetsConfigSchema,
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

describe('the budget files with project caps', () => {
  it('saves a project’s cap in its own file, never in the budgets file an older reader parses', () => {
    const files = budgetFilesOf(true, RULES);
    expect(files).toEqual({
      budgets: { enabled: true, rules: [RULES[0], RULES[2]] },
      projectBudgets: { rules: [RULES[1]] },
    });
    const parsed = previousSchema.safeParse(files.budgets);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.rules).toEqual([RULES[0], RULES[2]]);
    expect(projectBudgetsConfigSchema.parse(files.projectBudgets)).toEqual({
      rules: [RULES[1]],
    });
  });

  it('refuses a project scope inside the budgets file’s `rules`', () => {
    expect(
      budgetConfigSchema.safeParse({ enabled: true, rules: [RULES[1]] })
        .success,
    ).toBe(false);
  });

  it('reads both files back as one policy, every rule in one list', () => {
    const files = budgetFilesOf(true, RULES);
    const policy = effectiveBudgetConfig(
      budgetConfigSchema.parse(files.budgets),
      projectBudgetsConfigSchema.parse(files.projectBudgets),
    );
    expect(policy.enabled).toBe(true);
    expect(allBudgetRules(policy)).toEqual([RULES[0], RULES[2], RULES[1]]);
  });

  it('reads the project caps an earlier release kept in the budgets file while their own file has never been written', () => {
    const legacy = budgetConfigSchema.parse({
      enabled: true,
      rules: [RULES[0]],
      projectRules: [RULES[1]],
    });
    expect(allBudgetRules(effectiveBudgetConfig(legacy, null))).toEqual([
      RULES[0],
      RULES[1],
    ]);
    // Once the file exists it is the whole truth, an emptied one included.
    expect(
      allBudgetRules(effectiveBudgetConfig(legacy, { rules: [] })),
    ).toEqual([RULES[0]]);
  });

  it('follows the budgets file’s switch', () => {
    const { budgets, projectBudgets } = budgetFilesOf(false, RULES);
    expect(effectiveBudgetConfig(budgets, projectBudgets).enabled).toBe(false);
  });

  it('refuses a project cap that names no project, or one of another scope', () => {
    expect(
      projectBudgetsConfigSchema.safeParse({
        rules: [{ scope: 'project', scopeId: '', period: 'daily' }],
      }).success,
    ).toBe(false);
    expect(
      projectBudgetsConfigSchema.safeParse({ rules: [RULES[0]] }).success,
    ).toBe(false);
  });
});
