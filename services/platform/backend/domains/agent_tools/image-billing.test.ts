// @vitest-environment node

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  budgetPolicyActive,
  findBudgetViolation,
} from '../governance/budget-gate.ts';
import { incrementUsageLedger } from '../governance/service.ts';
import {
  TURN_MAX_GENERATED_IMAGES,
  turnImageBilling,
} from './image-billing.ts';

vi.mock('../governance/budget-gate.ts', () => ({
  budgetPolicyActive: vi.fn(),
  findBudgetViolation: vi.fn(),
  loadBudgetSubject: vi.fn(() => Promise.resolve({ organizationId: 'org_1' })),
}));
vi.mock('../governance/budget-refusal.ts', () => ({
  budgetRefusalMessage: () => "Your team's daily cost limit is reached.",
}));
vi.mock('../governance/budget-reservations.ts', () => ({
  lockBudgetAdmission: vi.fn(() => Promise.resolve()),
  readInFlightReservations: vi.fn(() => Promise.resolve({})),
}));
vi.mock('../governance/service.ts', () => ({
  incrementUsageLedger: vi.fn(() => Promise.resolve()),
}));

interface Statement {
  text: string;
  values: unknown[];
}

function fakeSql(): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const tx = (strings: TemplateStringsArray, ...values: unknown[]) => {
    statements.push({ text: strings.join('?'), values });
    return Promise.resolve([]);
  };
  const sql = Object.assign(tx, {
    begin: (work: (inner: typeof tx) => Promise<unknown>) => work(tx),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a tagged-template fake standing in for the pool
  return { sql: sql as unknown as Sql, statements };
}

const TURN = {
  organizationId: 'org_1',
  userId: 'user_1',
  threadId: 'thread_1',
  projectIds: ['proj_1'],
  agentSlug: 'assistant',
  unit: 'reply' as const,
};

beforeEach(() => {
  vi.mocked(budgetPolicyActive).mockReset().mockResolvedValue(true);
  vi.mocked(findBudgetViolation).mockReset().mockResolvedValue(null);
  vi.mocked(incrementUsageLedger).mockClear();
});

describe('turnImageBilling', () => {
  it('holds the estimate on the turn’s generation row while a cap binds', async () => {
    const { sql, statements } = fakeSql();
    const billing = turnImageBilling(sql, TURN);

    const admission = await billing.admit(2);

    expect(admission).toEqual({ admitted: true, holdCents: 50 });
    expect(findBudgetViolation).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        prospectiveCostCents: 50,
        prospectiveRequests: 1,
      }),
    );
    const hold = statements.find((s) =>
      s.text.includes('UPDATE app.generations'),
    );
    expect(hold?.values).toContain(50);
    expect(hold?.values).toContain('thread_1');
  });

  it('refuses with the cap’s own words, holding nothing [CHAT-R22]', async () => {
    vi.mocked(findBudgetViolation).mockResolvedValue(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the refusal message is mocked; the shape is not read
      {} as never,
    );
    const { sql, statements } = fakeSql();

    const admission = await turnImageBilling(sql, TURN).admit(1);

    expect(admission).toEqual({
      admitted: false,
      message: "Your team's daily cost limit is reached.",
    });
    expect(statements.some((s) => s.text.includes('UPDATE'))).toBe(false);
  });

  it('holds nothing where no budget binds', async () => {
    vi.mocked(budgetPolicyActive).mockResolvedValue(false);
    const { sql, statements } = fakeSql();
    await expect(turnImageBilling(sql, TURN).admit(1)).resolves.toEqual({
      admitted: true,
      holdCents: 0,
    });
    expect(statements).toHaveLength(0);
  });

  it('caps the images one reply may create [CHAT-R23]', async () => {
    vi.mocked(budgetPolicyActive).mockResolvedValue(false);
    const { sql } = fakeSql();
    const billing = turnImageBilling(sql, TURN);
    await billing.admit(TURN_MAX_GENERATED_IMAGES - 1);
    await expect(billing.admit(2)).resolves.toMatchObject({
      admitted: false,
      message: expect.stringContaining('1 more image'),
    });
  });

  it('counts the images of calls that run together, so parallel requests meet the ceiling [CHAT-R23]', async () => {
    // A round's calls run in the same tick: the budget check awaits, so a count
    // taken after it would read none admitted for every one of them.
    vi.mocked(budgetPolicyActive).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(false), 5)),
    );
    const { sql } = fakeSql();
    const billing = turnImageBilling(sql, TURN);

    const verdicts = await Promise.all(
      Array.from({ length: 10 }, () => billing.admit(4)),
    );

    // Four calls of four fill sixteen; the other six are refused, none admitted
    // past the ceiling.
    expect(verdicts.filter((verdict) => verdict.admitted)).toHaveLength(
      TURN_MAX_GENERATED_IMAGES / 4,
    );
    expect(verdicts.filter((verdict) => !verdict.admitted)).toHaveLength(
      10 - TURN_MAX_GENERATED_IMAGES / 4,
    );
  });

  it.each([
    [
      'a budget that refuses it',
      () =>
        vi
          .mocked(findBudgetViolation)
          .mockResolvedValueOnce({ kind: 'cost' } as never),
    ],
    [
      'a failure of its own',
      () =>
        vi
          .mocked(budgetPolicyActive)
          .mockRejectedValueOnce(new Error('database blinked')),
    ],
  ])(
    'gives the count back when an admission ends in %s, so the reply can still use its images [CHAT-R23]',
    async (_label, fail) => {
      vi.mocked(budgetPolicyActive).mockResolvedValue(true);
      const { sql } = fakeSql();
      const billing = turnImageBilling(sql, TURN);
      fail();

      await billing.admit(TURN_MAX_GENERATED_IMAGES).catch(() => undefined);

      // The whole ceiling is still there to spend.
      vi.mocked(budgetPolicyActive).mockResolvedValue(false);
      await expect(
        billing.admit(TURN_MAX_GENERATED_IMAGES),
      ).resolves.toMatchObject({ admitted: true });
    },
  );

  it('books each billed request under the person, in the chat’s project, and lowers the hold [CHAT-R22]', async () => {
    const { sql, statements } = fakeSql();

    await turnImageBilling(sql, TURN).settle({
      holdCents: 50,
      charges: [4, 3],
      provider: 'openrouter',
      model: 'img-1',
    });

    expect(incrementUsageLedger).toHaveBeenCalledTimes(2);
    expect(incrementUsageLedger).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: 'org_1',
        userId: 'user_1',
        agentSlug: 'assistant',
        projectIds: ['proj_1'],
        provider: 'openrouter',
        model: 'img-1',
        costEstimateCents: 4,
        inputTokens: 0,
        outputTokens: 0,
      }),
    );
    const release = statements.find((s) =>
      s.text.includes('greatest(0, reserved_cost_cents -'),
    );
    expect(release?.values).toContain(50);
  });

  it('books a task run’s images under its agent and words the ceiling for a run', async () => {
    vi.mocked(budgetPolicyActive).mockResolvedValue(false);
    const { sql } = fakeSql();
    const run = turnImageBilling(sql, {
      ...TURN,
      agentSlug: 'agent_7',
      unit: 'run',
    });

    await run.settle({
      holdCents: 0,
      charges: [5],
      provider: 'openrouter',
      model: 'img-1',
    });
    expect(incrementUsageLedger).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ agentSlug: 'agent_7', userId: 'user_1' }),
    );

    await run.admit(TURN_MAX_GENERATED_IMAGES);
    await expect(run.admit(1)).resolves.toMatchObject({
      admitted: false,
      message: expect.stringMatching(/^This run has created the 16 images/),
    });
  });
});
