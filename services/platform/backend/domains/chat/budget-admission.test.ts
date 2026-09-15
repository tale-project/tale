/**
 * The chat lane's budget admission: the sender is measured as they are now
 * (teams, role, the authenticating key), and a reached cap refuses with
 * `BUDGET_EXCEEDED`, naming the cap and when its period resets. The gate's
 * own evaluation is covered in `governance/budget-gate.test.ts`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BudgetViolation } from '../governance/budget-gate.ts';

const gate = vi.hoisted(() => ({
  violation: null as BudgetViolation | null,
  subjects: [] as unknown[],
}));

vi.mock('../governance/budget-gate.ts', () => ({
  loadBudgetSubject: vi.fn(
    async (
      _sql: unknown,
      args: { organizationId: string; userId: string; apiKeyId?: string },
    ) => ({ ...args, userTeamIds: ['team_1'], userRole: 'member' }),
  ),
  findBudgetViolation: vi.fn(async (_sql: unknown, subject: unknown) => {
    gate.subjects.push(subject);
    return gate.violation;
  }),
}));

const {
  assertChatTurnBudget,
  budgetRetryAfterSeconds,
  ChatBudgetExceededError,
} = await import('./budget-admission.ts');

const sql = (() => Promise.resolve([])) as never;
const RESETS_AT = Date.UTC(2026, 8, 16);

beforeEach(() => {
  gate.violation = null;
  gate.subjects = [];
});

describe('assertChatTurnBudget', () => {
  it('admits a turn no reached cap binds, measuring the member as they are now', async () => {
    await expect(
      assertChatTurnBudget(sql, { organizationId: 'org_1', userId: 'user_1' }),
    ).resolves.toBeUndefined();
    expect(gate.subjects).toEqual([
      {
        organizationId: 'org_1',
        userId: 'user_1',
        userTeamIds: ['team_1'],
        userRole: 'member',
      },
    ]);
  });

  it('measures a keyed turn against the key that authenticated it', async () => {
    await assertChatTurnBudget(sql, {
      organizationId: 'org_1',
      userId: 'user_1',
      apiKeyId: 'key_1',
    });
    expect(gate.subjects).toEqual([
      expect.objectContaining({ userId: 'user_1', apiKeyId: 'key_1' }),
    ]);
  });

  it('refuses a reached cap with BUDGET_EXCEEDED, naming the cap and its reset', async () => {
    gate.violation = {
      scope: 'team',
      teamId: 'team_1',
      code: 'COST_LIMIT',
      period: 'daily',
      used: 500,
      limit: 500,
      reason: 'Cost limit reached for this daily period ($5.00 / $5.00)',
      resetsAt: RESETS_AT,
    };
    const refusal = await assertChatTurnBudget(sql, {
      organizationId: 'org_1',
      userId: 'user_1',
    }).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(ChatBudgetExceededError);
    expect(
      (refusal as InstanceType<typeof ChatBudgetExceededError>).data,
    ).toEqual({
      code: 'BUDGET_EXCEEDED',
      message:
        "Usage limit reached. Your team's daily cost limit is used up until 2026-09-16T00:00:00.000Z.",
      scope: 'team',
      teamId: 'team_1',
      limitCode: 'COST_LIMIT',
      period: 'daily',
      used: 500,
      limit: 500,
      resetsAt: RESETS_AT,
    });
  });

  it('names the bucket that is spent in the sentence', async () => {
    const sentences: string[] = [];
    for (const scope of ['user', 'org', 'apiKey'] as const) {
      gate.violation = {
        scope,
        code: 'REQUEST_LIMIT',
        period: 'monthly',
        used: 10,
        limit: 10,
        reason: 'Request limit reached',
        resetsAt: RESETS_AT,
      };
      const refusal = await assertChatTurnBudget(sql, {
        organizationId: 'org_1',
        userId: 'user_1',
      }).catch((error: unknown) => error);
      sentences.push(
        (refusal as InstanceType<typeof ChatBudgetExceededError>).data.message,
      );
    }
    expect(sentences).toEqual([
      'Usage limit reached. Your monthly request limit is used up until 2026-09-16T00:00:00.000Z.',
      "Usage limit reached. The organization's monthly request limit is used up until 2026-09-16T00:00:00.000Z.",
      "Usage limit reached. This API key's monthly request limit is used up until 2026-09-16T00:00:00.000Z.",
    ]);
  });
});

describe('budgetRetryAfterSeconds', () => {
  it('rounds the wait up to whole seconds, and never answers less than one', () => {
    expect(budgetRetryAfterSeconds(RESETS_AT, RESETS_AT - 90_500)).toBe(91);
    expect(budgetRetryAfterSeconds(RESETS_AT, RESETS_AT - 1)).toBe(1);
    expect(budgetRetryAfterSeconds(RESETS_AT, RESETS_AT + 5_000)).toBe(1);
  });
});
