/**
 * The reservation: under the org admission lock, the allowance is resolved
 * for the run's starter against the ledger plus every unsettled op's
 * reservation, and recorded on this op's row; a refusal records nothing.
 * The allowance evaluation is replaced (its own test owns it); the SQL
 * choreography is asserted on a scripted `sql`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const gate = vi.hoisted(() => ({
  resolveTurnAllowance: vi.fn(),
  loadBudgetSubject: vi.fn(
    async (_tx: unknown, args: { organizationId: string; userId: string }) => ({
      ...args,
      userTeamIds: ['team-1'],
      userRole: 'member',
    }),
  ),
}));

vi.mock('../governance/budget-gate.ts', () => gate);

const HOLDS = {
  org: { costCents: 700, tokens: 0, requests: 2 },
  user: { costCents: 200, tokens: 0, requests: 1 },
  teams: {},
};
const holds = vi.hoisted(() => ({
  lockBudgetAdmission: vi.fn(async () => undefined),
  readInFlightReservations: vi.fn(),
}));
vi.mock('../governance/budget-reservations.ts', () => holds);

const { reserveTurnBudget } = await import('./turn-budget.ts');

interface Statement {
  text: string;
  values: unknown[];
}

function fakeSql(answers: Array<{ match: string; rows: unknown[] }>) {
  const statements: Statement[] = [];
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    const hit = answers.find((answer) => text.includes(answer.match));
    return Promise.resolve(hit?.rows ?? []);
  };
  const sql = Object.assign(run, {
    begin: async (fn: (tx: unknown) => Promise<unknown>) => fn(sql),
  });
  return { sql: sql as never, statements };
}

const ARGS = {
  organizationId: 'org-1',
  sessionId: 'pa-alice',
  execId: 'exec-1',
  kind: 'task-agent' as const,
  defaultBudgetCents: 500,
  modelRef: 'openai/openai/gpt-5',
};

beforeEach(() => {
  vi.clearAllMocks();
  holds.readInFlightReservations.mockResolvedValue(HOLDS);
});

describe('reserveTurnBudget', () => {
  it('evaluates the allowance for the starter with the in-flight reservations and records it', async () => {
    gate.resolveTurnAllowance.mockResolvedValue({
      allowed: true,
      budgetCents: 300,
    });
    const { sql, statements } = fakeSql([
      {
        match: 'FROM app.project_agent_runs r',
        rows: [{ startedBy: 'user-1', agentName: 'Alice' }],
      },
    ]);

    const result = await reserveTurnBudget(sql, ARGS);

    expect(result).toEqual({ allowed: true, budgetCents: 300 });
    // The org admission lock comes first.
    expect(statements[0]?.text).toContain('pg_advisory_xact_lock');
    // The starter is measured as they are now — teams and role — through
    // the one subject reader every budget lane uses.
    expect(gate.loadBudgetSubject).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
      userId: 'user-1',
    });
    expect(gate.resolveTurnAllowance).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: 'org-1',
        userId: 'user-1',
        userTeamIds: ['team-1'],
        userRole: 'member',
        defaultCents: 500,
        reservations: HOLDS,
      }),
    );
    // The holds are read under the budget-admission lock the chat lane's
    // opens share, and leave this very op out.
    expect(holds.lockBudgetAdmission).toHaveBeenCalledWith(
      expect.anything(),
      'org-1',
    );
    expect(holds.readInFlightReservations).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'user-1' }),
      { op: { sessionId: 'pa-alice', execId: 'exec-1' } },
    );
    // The op row carries the reservation and the attribution.
    const upsert = statements.find((s) =>
      s.text.includes('INSERT INTO app.sandbox_session_ops'),
    );
    expect(upsert?.text).toContain('budget_cents');
    expect(upsert?.values).toEqual(
      expect.arrayContaining([
        'org-1',
        'pa-alice',
        'exec-1',
        'task-agent',
        'user-1',
        'Alice',
        300,
      ]),
    );
  });

  it('records nothing when the cap refuses', async () => {
    gate.resolveTurnAllowance.mockResolvedValue({
      allowed: false,
      reason: 'Cost limit reached for this monthly period ($100.00 / $100.00)',
    });
    const { sql, statements } = fakeSql([
      {
        match: 'FROM app.project_agent_runs r',
        rows: [{ startedBy: 'user-1', agentName: 'Alice' }],
      },
    ]);

    const result = await reserveTurnBudget(sql, ARGS);

    expect(result).toEqual({
      allowed: false,
      reason: 'Cost limit reached for this monthly period ($100.00 / $100.00)',
    });
    expect(
      statements.some((s) =>
        s.text.includes('INSERT INTO app.sandbox_session_ops'),
      ),
    ).toBe(false);
  });

  it('evaluates an op without a starter against the org buckets only', async () => {
    gate.resolveTurnAllowance.mockResolvedValue({
      allowed: true,
      budgetCents: 500,
    });
    const { sql, statements } = fakeSql([]);

    const result = await reserveTurnBudget(sql, ARGS);

    expect(result).toEqual({ allowed: true, budgetCents: 500 });
    expect(gate.resolveTurnAllowance).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: '', userTeamIds: [] }),
    );
    // No membership lookups for an unknown starter.
    expect(gate.loadBudgetSubject).not.toHaveBeenCalled();
    expect(statements.some((s) => s.text.includes('FROM "member"'))).toBe(
      false,
    );
  });
});
