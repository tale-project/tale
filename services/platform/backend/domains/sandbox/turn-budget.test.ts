/**
 * The reservation: under the org admission lock, the allowance is resolved
 * for the run's starter against the ledger plus every unsettled op's
 * reservation, and recorded on this op's row; a refusal records nothing.
 * The allowance evaluation is replaced (its own test owns it); the SQL
 * choreography is asserted on a scripted `sql`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const gate = vi.hoisted(() => ({ resolveTurnAllowance: vi.fn() }));

vi.mock('../governance/budget-gate.ts', () => gate);
vi.mock('../../auth/membership.ts', () => ({
  getUserTeamIds: vi.fn(async () => ['team-1']),
}));

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
      { match: 'FROM "member"', rows: [{ role: 'member' }] },
      {
        match: 'coalesce(sum(budget_cents), 0)',
        rows: [{ orgCents: 700, userCents: 200 }],
      },
    ]);

    const result = await reserveTurnBudget(sql, ARGS);

    expect(result).toEqual({ allowed: true, budgetCents: 300 });
    // The org admission lock comes first.
    expect(statements[0]?.text).toContain('pg_advisory_xact_lock');
    expect(gate.resolveTurnAllowance).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: 'org-1',
        userId: 'user-1',
        userTeamIds: ['team-1'],
        userRole: 'member',
        defaultCents: 500,
        reserved: { orgCents: 700, userCents: 200 },
      }),
    );
    // The reservation sum excludes this very op and only counts unsettled
    // reservations.
    const sum = statements.find((s) =>
      s.text.includes('coalesce(sum(budget_cents), 0)'),
    );
    expect(sum?.text).toContain(
      'budget_cents IS NOT NULL AND spend_settled_at_ms IS NULL',
    );
    expect(sum?.text).toContain('AND NOT (session_id = ? AND exec_id = ?)');
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
    expect(statements.some((s) => s.text.includes('FROM "member"'))).toBe(
      false,
    );
  });
});
