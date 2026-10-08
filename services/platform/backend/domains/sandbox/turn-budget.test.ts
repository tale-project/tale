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

/** A workflow session's owner: the automation run it executes. */
const WORKFLOW_SESSION = {
  match: 'FROM app.sandbox_sessions s',
  rows: [{ runId: 'run-1' }],
};

const ARGS = {
  organizationId: 'org-1',
  sessionId: 'pa-alice',
  execId: 'exec-1',
  kind: 'task-agent' as const,
  defaultBudgetCents: 500,
  modelRef: 'openai/openai/gpt-5',
  harness: 'pi',
};

beforeEach(() => {
  vi.clearAllMocks();
  holds.readInFlightReservations.mockResolvedValue(HOLDS);
});

describe('reserveTurnBudget', () => {
  it('evaluates the allowance for the starter with the in-flight reservations and records it [SBX-R16]', async () => {
    gate.resolveTurnAllowance.mockResolvedValue({
      allowed: true,
      budgetCents: 300,
    });
    const { sql, statements } = fakeSql([
      {
        match: 'FROM app.project_agent_runs r',
        rows: [{ startedBy: 'user-1', agentId: 'agent-alice' }],
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
        'agent-alice',
        300,
      ]),
    );
    // The op records the harness the turn runs on: the session's stamp is
    // the harness it was CREATED with, which a standing session keeps
    // across the agent's switches. A later write without one keeps it.
    expect(upsert?.values).toContain('pi');
    expect(upsert?.text).toContain(
      'harness = coalesce(EXCLUDED.harness, app.sandbox_session_ops.harness)',
    );
  });

  it('holds a subscription turn as one request at no cost [GOV-R16]', async () => {
    gate.resolveTurnAllowance.mockResolvedValue({
      allowed: true,
      budgetCents: 0,
    });
    const { sql, statements } = fakeSql([
      {
        match: 'FROM app.project_agent_runs r',
        rows: [{ startedBy: 'user-1', agentId: 'agent-alice' }],
      },
    ]);

    const result = await reserveTurnBudget(sql, {
      ...ARGS,
      defaultBudgetCents: 0,
      costFree: true,
      modelRef: 'anthropic/claude-sonnet-4-5',
    });

    expect(result).toEqual({ allowed: true, budgetCents: 0 });
    // No cent floor: the turn is measured at no cost, request and token
    // caps alone.
    expect(gate.resolveTurnAllowance).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ defaultCents: 0, costFree: true }),
    );
    // A 0-cent hold is still a hold: one request while the turn runs.
    const upsert = statements.find((s) =>
      s.text.includes('INSERT INTO app.sandbox_session_ops'),
    );
    expect(upsert?.values).toEqual(
      expect.arrayContaining(['task-agent', 'user-1', 'agent-alice', 0]),
    );
  });

  it('records nothing when the cap refuses [SBX-R16]', async () => {
    gate.resolveTurnAllowance.mockResolvedValue({
      allowed: false,
      reason: 'Cost limit reached for this monthly period ($100.00 / $100.00)',
    });
    const { sql, statements } = fakeSql([
      {
        match: 'FROM app.project_agent_runs r',
        rows: [{ startedBy: 'user-1', agentId: 'agent-alice' }],
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
      expect.objectContaining({
        userId: '',
        userTeamIds: [],
        impersonal: true,
      }),
    );
    // No membership lookups for an unknown starter.
    expect(gate.loadBudgetSubject).not.toHaveBeenCalled();
    expect(statements.some((s) => s.text.includes('FROM "member"'))).toBe(
      false,
    );
  });

  it('measures a keyed workflow start as the person AND the key, and stamps both', async () => {
    gate.resolveTurnAllowance.mockResolvedValue({
      allowed: true,
      budgetCents: 500,
    });
    const { sql, statements } = fakeSql([
      WORKFLOW_SESSION,
      {
        match: 'FROM app.automation_runs ar WHERE',
        rows: [
          {
            startedBy: 'api-key:user-7',
            name: 'invoices/monthly',
            apiKeyId: 'key-1',
          },
        ],
      },
    ]);

    await reserveTurnBudget(sql, {
      ...ARGS,
      sessionId: 'wf-run-1',
      kind: 'workflow-agent',
    });

    expect(gate.loadBudgetSubject).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
      userId: 'user-7',
      apiKeyId: 'key-1',
    });
    const upsert = statements.find((s) =>
      s.text.includes('INSERT INTO app.sandbox_session_ops'),
    );
    expect(upsert?.text).toContain('api_key_id');
    expect(upsert?.values).toEqual(
      expect.arrayContaining(['user-7', 'invoices/monthly', 'key-1']),
    );
  });

  it('measures a model-endpoint request as the subject its door authenticated, and stamps it', async () => {
    gate.resolveTurnAllowance.mockResolvedValue({
      allowed: true,
      budgetCents: 40,
    });
    const { sql, statements } = fakeSql([]);

    await reserveTurnBudget(sql, {
      organizationId: 'org-1',
      sessionId: 'model-api:key-9',
      execId: 'req-1',
      kind: 'model-api',
      defaultBudgetCents: 40,
      modelRef: 'openrouter/openrouter/anthropic/claude-sonnet-4.6',
      subject: {
        userId: 'user-3',
        agentSlug: '__direct_api__',
        apiKeyId: 'key-9',
      },
    });

    // No run to derive the subject from — the door named it.
    expect(
      statements.some(
        (s) =>
          s.text.includes('app.project_agent_runs') ||
          s.text.includes('app.automation_runs'),
      ),
    ).toBe(false);
    expect(gate.loadBudgetSubject).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
      userId: 'user-3',
      apiKeyId: 'key-9',
    });
    const upsert = statements.find((s) =>
      s.text.includes('INSERT INTO app.sandbox_session_ops'),
    );
    expect(upsert?.values).toEqual(
      expect.arrayContaining([
        'model-api:key-9',
        'req-1',
        'model-api',
        'user-3',
        '__direct_api__',
        'key-9',
        40,
      ]),
    );
  });

  it('admits a model-endpoint request whole, under the budget lock alone, and records the tokens it holds', async () => {
    gate.resolveTurnAllowance.mockResolvedValue({
      allowed: true,
      budgetCents: 12,
    });
    const { sql, statements } = fakeSql([
      { match: 'count(*) FILTER', rows: [{ user: 2, apiKey: 1 }] },
    ]);

    await reserveTurnBudget(sql, {
      organizationId: 'org-1',
      sessionId: 'model-api:key-9',
      execId: 'req-2',
      kind: 'model-api',
      defaultBudgetCents: 12,
      subject: {
        userId: 'user-3',
        agentSlug: '__direct_api__',
        apiKeyId: 'key-9',
      },
      whole: { prospectiveTokens: 40_000 },
      concurrencyLimit: 8,
    });

    // No sandbox is admitted: the sandbox admission lock is not taken.
    expect(
      statements.some((s) => s.text.includes("hashtextextended('sandbox:'")),
    ).toBe(false);
    expect(holds.lockBudgetAdmission).toHaveBeenCalled();
    expect(gate.resolveTurnAllowance).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        defaultCents: 12,
        whole: { prospectiveTokens: 40_000 },
      }),
    );
    const upsert = statements.find((s) =>
      s.text.includes('INSERT INTO app.sandbox_session_ops'),
    );
    expect(upsert?.text).toContain('reserved_tokens');
    expect(upsert?.values).toEqual(expect.arrayContaining([12, 40_000]));
  });

  it.each([
    [{ user: 8, apiKey: 3 }, 'user', 'You already have 8'],
    [{ user: 8, apiKey: 8 }, 'apiKey', 'This API key already has 8'],
  ] as const)(
    'refuses one request too many at once (%j), holding nothing',
    async (running, scope, wording) => {
      const { sql, statements } = fakeSql([
        { match: 'count(*) FILTER', rows: [running] },
      ]);

      const result = await reserveTurnBudget(sql, {
        organizationId: 'org-1',
        sessionId: 'model-api:key-9',
        execId: 'req-3',
        kind: 'model-api',
        defaultBudgetCents: 12,
        subject: {
          userId: 'user-3',
          agentSlug: '__direct_api__',
          apiKeyId: 'key-9',
        },
        whole: { prospectiveTokens: 100 },
        concurrencyLimit: 8,
      });

      expect(result).toMatchObject({
        allowed: false,
        concurrency: { scope, limit: 8 },
      });
      expect(result.allowed ? '' : result.reason).toContain(wording);
      const count = statements.find((s) => s.text.includes('count(*) FILTER'));
      expect(count?.text).toContain("kind = ? AND status = 'running'");
      expect(count?.values).toEqual(
        expect.arrayContaining(['user-3', 'key-9', 'org-1', 'model-api']),
      );
      expect(gate.resolveTurnAllowance).not.toHaveBeenCalled();
      expect(
        statements.some((s) =>
          s.text.includes('INSERT INTO app.sandbox_session_ops'),
        ),
      ).toBe(false);
    },
  );

  it('evaluates a trigger-started run as nobody: org caps only, booked under the automation sentinel [SBX-R14]', async () => {
    gate.resolveTurnAllowance.mockResolvedValue({
      allowed: true,
      budgetCents: 500,
    });
    const { sql, statements } = fakeSql([
      WORKFLOW_SESSION,
      {
        match: 'FROM app.automation_runs ar WHERE',
        rows: [
          {
            startedBy: 'trigger:t-1',
            name: 'invoices/monthly',
            apiKeyId: null,
          },
        ],
      },
    ]);

    await reserveTurnBudget(sql, {
      ...ARGS,
      sessionId: 'wf-run-2',
      kind: 'workflow-agent',
    });

    expect(gate.loadBudgetSubject).not.toHaveBeenCalled();
    expect(gate.resolveTurnAllowance).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: '__automation__',
        userTeamIds: [],
        impersonal: true,
      }),
    );
    const upsert = statements.find((s) =>
      s.text.includes('INSERT INTO app.sandbox_session_ops'),
    );
    expect(upsert?.values).toEqual(
      expect.arrayContaining(['__automation__', 'invoices/monthly']),
    );
  });

  describe('in a project [GOV-R14]', () => {
    function projectStamp(statements: Statement[]): unknown {
      const upsert = statements.find((s) =>
        s.text.includes('INSERT INTO app.sandbox_session_ops'),
      );
      // `project_ids` follows `api_key_id` in the insert's column list.
      return upsert?.values[7];
    }

    it('holds an agent’s turn to its run’s project and stamps the project on the op', async () => {
      gate.resolveTurnAllowance.mockResolvedValue({
        allowed: true,
        budgetCents: 500,
      });
      const { sql, statements } = fakeSql([
        {
          match: 'FROM app.project_agent_runs r',
          rows: [
            { startedBy: 'user-1', agentId: 'agent-1', projectId: 'project-1' },
          ],
        },
      ]);
      await reserveTurnBudget(sql, ARGS);
      expect(gate.loadBudgetSubject).toHaveBeenCalledWith(expect.anything(), {
        organizationId: 'org-1',
        userId: 'user-1',
        projectIds: ['project-1'],
      });
      expect(projectStamp(statements)).toEqual(['project-1']);
    });

    it('holds a run a schedule started to its project’s caps too', async () => {
      gate.resolveTurnAllowance.mockResolvedValue({
        allowed: true,
        budgetCents: 500,
      });
      const { sql, statements } = fakeSql([
        WORKFLOW_SESSION,
        {
          match: 'FROM app.automation_runs ar WHERE',
          rows: [
            {
              startedBy: 'trigger:t-1',
              name: 'invoices/monthly',
              apiKeyId: null,
              projectId: 'project-1',
            },
          ],
        },
      ]);
      await reserveTurnBudget(sql, {
        ...ARGS,
        sessionId: 'wf-run-3',
        kind: 'workflow-agent',
      });
      expect(gate.resolveTurnAllowance).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          impersonal: true,
          projectIds: ['project-1'],
        }),
      );
      expect(projectStamp(statements)).toEqual(['project-1']);
    });

    it('stamps a project’s own key’s model request with the key’s project', async () => {
      gate.resolveTurnAllowance.mockResolvedValue({
        allowed: true,
        budgetCents: 40,
      });
      // The key's binding names its project (`loadBudgetSubject`).
      gate.loadBudgetSubject.mockResolvedValueOnce({
        organizationId: 'org-1',
        userId: 'identity-1',
        userTeamIds: [],
        userRole: 'member',
        impersonal: true,
        apiKeyId: 'key-9',
        projectIds: ['project-1'],
      } as never);
      const { sql, statements } = fakeSql([]);
      await reserveTurnBudget(sql, {
        organizationId: 'org-1',
        sessionId: 'model-api:key-9',
        execId: 'req-2',
        kind: 'model-api',
        defaultBudgetCents: 40,
        subject: {
          userId: 'identity-1',
          agentSlug: '__direct_api__',
          apiKeyId: 'key-9',
        },
      });
      expect(projectStamp(statements)).toEqual(['project-1']);
    });

    it('holds an unscoped run of an automation bound to two projects to both, and stamps both', async () => {
      gate.resolveTurnAllowance.mockResolvedValue({
        allowed: true,
        budgetCents: 500,
      });
      const { sql, statements } = fakeSql([
        WORKFLOW_SESSION,
        {
          match: 'FROM app.automation_runs ar WHERE',
          rows: [
            {
              startedBy: 'trigger:t-1',
              name: 'invoices/monthly',
              apiKeyId: null,
              projectId: null,
              boundProjectIds: ['project-1', 'project-2'],
            },
          ],
        },
      ]);
      await reserveTurnBudget(sql, {
        ...ARGS,
        sessionId: 'wf-run-4',
        kind: 'workflow-agent',
      });
      expect(gate.resolveTurnAllowance).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ projectIds: ['project-1', 'project-2'] }),
      );
      expect(projectStamp(statements)).toEqual(['project-1', 'project-2']);
    });

    it('stamps no project on work outside one', async () => {
      gate.resolveTurnAllowance.mockResolvedValue({
        allowed: true,
        budgetCents: 500,
      });
      const { sql, statements } = fakeSql([
        {
          match: 'FROM app.project_agent_runs r',
          rows: [{ startedBy: 'user-1', agentId: 'agent-1', projectId: null }],
        },
      ]);
      await reserveTurnBudget(sql, ARGS);
      expect(projectStamp(statements)).toBeNull();
    });
  });
});
