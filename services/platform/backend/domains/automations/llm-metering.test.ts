/**
 * An automation's `llm` step is measured and booked as its run's spend: the
 * run's own subject (`resolveAutomationRunAttribution`, proven in its suite)
 * is measured against every cap that binds it, counting the work in flight,
 * and each call's tokens are booked under it. The gate, the holds and the
 * ledger writer are stand-ins; the refusal's wording is the real one.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTOMATION_SUBJECT_ID } from '../../../lib/shared/constants/usage.ts';

const mocks = vi.hoisted(() => ({
  resolveAutomationRunAttribution: vi.fn(),
  budgetPolicyActive: vi.fn(),
  findBudgetViolation: vi.fn(),
  loadBudgetSubject: vi.fn(),
  readInFlightReservations: vi.fn(),
  record: vi.fn(async () => undefined),
}));

vi.mock('../sandbox/op-attribution.ts', () => ({
  resolveAutomationRunAttribution: mocks.resolveAutomationRunAttribution,
}));
vi.mock('../governance/budget-gate.ts', () => ({
  budgetPolicyActive: mocks.budgetPolicyActive,
  findBudgetViolation: mocks.findBudgetViolation,
  loadBudgetSubject: mocks.loadBudgetSubject,
}));
vi.mock('../governance/budget-reservations.ts', () => ({
  readInFlightReservations: mocks.readInFlightReservations,
}));
vi.mock('../chat/store.ts', () => ({
  createPgUsageLedger: () => ({ record: mocks.record }),
}));

const { checkLlmStepBudget, recordLlmStepUsage } =
  await import('./llm-metering.ts');

const SQL = {} as Sql;
const RUN = { organizationId: 'org-1', runId: 'run-1' };
const HOLDS = { org: { costCents: 40, tokens: 0, requests: 1 } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.budgetPolicyActive.mockResolvedValue(true);
  mocks.findBudgetViolation.mockResolvedValue(null);
  mocks.readInFlightReservations.mockResolvedValue(HOLDS);
  mocks.loadBudgetSubject.mockImplementation(
    async (_sql: unknown, args: object) => ({ ...args, userTeamIds: [] }),
  );
});

describe('checkLlmStepBudget', () => {
  it('admits every call while no budget policy binds, reading nothing else', async () => {
    mocks.budgetPolicyActive.mockResolvedValue(false);
    await expect(checkLlmStepBudget(SQL, RUN)).resolves.toEqual({
      allowed: true,
    });
    expect(mocks.resolveAutomationRunAttribution).not.toHaveBeenCalled();
    expect(mocks.findBudgetViolation).not.toHaveBeenCalled();
  });

  it('measures the run’s person, key and projects, counting the work in flight [GOV-R14]', async () => {
    mocks.resolveAutomationRunAttribution.mockResolvedValue({
      userId: 'user-2',
      agentSlug: 'invoices/monthly',
      apiKeyId: 'key-1',
      projectIds: ['project-1', 'project-2'],
    });

    await expect(checkLlmStepBudget(SQL, RUN)).resolves.toEqual({
      allowed: true,
    });

    expect(mocks.resolveAutomationRunAttribution).toHaveBeenCalledWith(
      SQL,
      RUN,
    );
    const subject = {
      organizationId: 'org-1',
      userId: 'user-2',
      apiKeyId: 'key-1',
      projectIds: ['project-1', 'project-2'],
    };
    expect(mocks.loadBudgetSubject).toHaveBeenCalledWith(SQL, subject);
    expect(mocks.findBudgetViolation).toHaveBeenCalledWith(
      SQL,
      expect.objectContaining(subject),
      { reservations: HOLDS },
    );
  });

  it('measures a run a trigger started as nobody: the organization’s caps, and its projects’', async () => {
    mocks.resolveAutomationRunAttribution.mockResolvedValue({
      userId: AUTOMATION_SUBJECT_ID,
      agentSlug: 'invoices/monthly',
      projectIds: ['project-1'],
    });

    await checkLlmStepBudget(SQL, RUN);

    expect(mocks.loadBudgetSubject).not.toHaveBeenCalled();
    expect(mocks.findBudgetViolation).toHaveBeenCalledWith(
      SQL,
      {
        organizationId: 'org-1',
        userId: AUTOMATION_SUBJECT_ID,
        userTeamIds: [],
        impersonal: true,
        projectIds: ['project-1'],
      },
      { reservations: HOLDS },
    );
  });

  it('refuses once a cap is reached, naming it in the gate’s own sentence [GOV-R4]', async () => {
    mocks.resolveAutomationRunAttribution.mockResolvedValue({
      userId: AUTOMATION_SUBJECT_ID,
      projectIds: ['project-1'],
    });
    mocks.findBudgetViolation.mockResolvedValue({
      scope: 'project',
      projectId: 'project-1',
      code: 'COST_LIMIT',
      period: 'monthly',
      used: 100,
      limit: 100,
      reason: 'Cost limit reached',
      resetsAt: Date.UTC(2026, 10, 1),
    });

    await expect(checkLlmStepBudget(SQL, RUN)).resolves.toEqual({
      allowed: false,
      reason:
        "Usage limit reached. This project's monthly cost limit is used up until 2026-11-01T00:00:00.000Z.",
    });
  });
});

describe('recordLlmStepUsage', () => {
  const USAGE = {
    ...RUN,
    provider: 'openrouter',
    model: 'anthropic/claude-haiku-4.5',
    inputTokens: 120,
    outputTokens: 30,
  };

  it('books the call under the run’s subject, in each of its projects [GOV-R14]', async () => {
    mocks.resolveAutomationRunAttribution.mockResolvedValue({
      userId: 'user-3',
      agentSlug: 'invoices/monthly',
      apiKeyId: 'key-1',
      projectIds: ['project-1', 'project-2'],
    });

    await recordLlmStepUsage(SQL, USAGE);

    expect(mocks.record).toHaveBeenCalledWith({
      organizationId: 'org-1',
      userId: 'user-3',
      apiKeyId: 'key-1',
      agentSlug: 'invoices/monthly',
      model: 'anthropic/claude-haiku-4.5',
      provider: 'openrouter',
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
      projectIds: ['project-1', 'project-2'],
    });
  });

  it('books a run outside every project to the ledger alone', async () => {
    mocks.resolveAutomationRunAttribution.mockResolvedValue({
      userId: AUTOMATION_SUBJECT_ID,
      agentSlug: 'invoices/monthly',
    });

    await recordLlmStepUsage(SQL, USAGE);

    expect(mocks.record).toHaveBeenCalledWith(
      expect.not.objectContaining({ projectIds: expect.anything() }),
    );
  });

  it('books nothing, and says so, for a run that names no one', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.resolveAutomationRunAttribution.mockResolvedValue(null);

    await recordLlmStepUsage(SQL, USAGE);

    expect(mocks.record).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('run run-1 names no one to book its llm step to'),
    );
    error.mockRestore();
  });
});
