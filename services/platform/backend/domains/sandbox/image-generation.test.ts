/**
 * The Postgres seams of `generate_image`: which turn a token's op is (and
 * whether its run still runs), whose budget a generation is measured
 * against, and the ledger booking — the same person and agent the turn's
 * own spend is booked under (`governance/README.md`), `__automation__` for
 * a run nobody started. SQL, the attribution resolver and the budget gate
 * are stubbed; their own suites cover them.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  attribution: vi.fn(),
  loadBudgetSubject: vi.fn(),
  findBudgetViolation: vi.fn(),
  readInFlightReservations: vi.fn(),
  incrementUsageLedger: vi.fn(),
}));

vi.mock('./op-attribution.ts', () => ({
  resolveSessionOpAttribution: mocks.attribution,
}));
vi.mock('../governance/budget-gate.ts', () => ({
  loadBudgetSubject: mocks.loadBudgetSubject,
  findBudgetViolation: mocks.findBudgetViolation,
}));
vi.mock('../governance/budget-reservations.ts', () => ({
  readInFlightReservations: mocks.readInFlightReservations,
}));
vi.mock('../governance/service.ts', () => ({
  incrementUsageLedger: mocks.incrementUsageLedger,
}));

const {
  checkImageGenerationBudget,
  imageGenerationShimHandlers,
  recordImageGenerationUsage,
  resolveImageTurnContext,
} = await import('./image-generation.ts');

let rows: unknown[] = [];
const statements: Array<{ text: string; values: unknown[] }> = [];
const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
  statements.push({ text: strings.join('?'), values });
  return Promise.resolve(rows);
}) as unknown as Sql;

beforeEach(() => {
  vi.clearAllMocks();
  rows = [];
  statements.length = 0;
  mocks.attribution.mockResolvedValue({
    userId: 'user_starter',
    agentSlug: 'agent_1',
  });
  mocks.loadBudgetSubject.mockImplementation(
    async (_sql: unknown, args: Record<string, unknown>) => ({
      ...args,
      userTeamIds: ['team_1'],
      userRole: 'member',
    }),
  );
  mocks.readInFlightReservations.mockResolvedValue({ org: undefined });
  mocks.findBudgetViolation.mockResolvedValue(null);
  mocks.incrementUsageLedger.mockResolvedValue(undefined);
});

describe('resolveImageTurnContext', () => {
  it('delivers a live task run into its task’s own box, for its starter', async () => {
    rows = [{ taskId: 'task_1' }];
    const context = await resolveImageTurnContext(sql, {
      organizationId: 'org_1',
      sessionId: 'pa-alice',
      kind: 'task-agent',
      execId: 'exec_1',
    });
    expect(context).toEqual({
      status: 'live',
      outputDir: '/agent/output/task_1',
      subject: { userId: 'user_starter', agentSlug: 'agent_1' },
    });
    expect(statements[0]?.text).toContain('FROM app.project_agent_runs');
    expect(statements[0]?.text).toContain("status IN ('queued', 'running')");
    expect(statements[0]?.values).toEqual(['org_1', 'pa-alice', 'exec_1']);
    expect(mocks.attribution).toHaveBeenCalledWith(sql, {
      organizationId: 'org_1',
      sessionId: 'pa-alice',
      kind: 'task-agent',
      execId: 'exec_1',
    });
  });

  it('delivers a live automation step into its run output', async () => {
    rows = [{ id: 'op_1' }];
    mocks.attribution.mockResolvedValue({
      userId: 'user_api',
      agentSlug: 'campaigns/visual',
      apiKeyId: 'key_1',
    });
    await expect(
      resolveImageTurnContext(sql, {
        organizationId: 'org_1',
        sessionId: 'wf-run-1',
        kind: 'workflow-agent',
        execId: 'exec_w',
      }),
    ).resolves.toEqual({
      status: 'live',
      outputDir: '/agent/output',
      subject: {
        userId: 'user_api',
        agentSlug: 'campaigns/visual',
        apiKeyId: 'key_1',
      },
    });
    expect(statements[0]?.text).toContain('FROM app.sandbox_session_ops');
    expect(statements[0]?.text).toContain("status = 'running'");
    expect(statements[0]?.text).toContain('finalized_at_ms IS NULL');
  });

  it.each(['task-agent', 'workflow-agent'] as const)(
    'reads a %s turn whose run has ended as ended, naming nobody',
    async (kind) => {
      rows = [];
      await expect(
        resolveImageTurnContext(sql, {
          organizationId: 'org_1',
          sessionId: 'sess_1',
          kind,
          execId: 'exec_1',
        }),
      ).resolves.toEqual({ status: 'ended' });
      expect(mocks.attribution).not.toHaveBeenCalled();
    },
  );

  it('books a run nobody started under the automation sentinel', async () => {
    rows = [{ taskId: 'task_1' }];
    mocks.attribution.mockResolvedValue(null);
    await expect(
      resolveImageTurnContext(sql, {
        organizationId: 'org_1',
        sessionId: 'pa-alice',
        kind: 'task-agent',
        execId: 'exec_1',
      }),
    ).resolves.toMatchObject({ subject: { userId: '__automation__' } });
  });
});

describe('checkImageGenerationBudget', () => {
  const ARGS = {
    organizationId: 'org_1',
    sessionId: 'pa-alice',
    execId: 'exec_1',
    subject: { userId: 'user_starter', agentSlug: 'agent_1' },
    images: 3,
  };

  it('measures the person as they are now, net of every OTHER hold, with room for every image', async () => {
    await expect(checkImageGenerationBudget(sql, ARGS)).resolves.toEqual({
      allowed: true,
    });
    expect(mocks.loadBudgetSubject).toHaveBeenCalledWith(sql, {
      organizationId: 'org_1',
      userId: 'user_starter',
    });
    expect(mocks.readInFlightReservations).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({ userId: 'user_starter' }),
      { op: { sessionId: 'pa-alice', execId: 'exec_1' } },
    );
    expect(mocks.findBudgetViolation).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({ userTeamIds: ['team_1'] }),
      { reservations: { org: undefined }, prospectiveRequests: 2 },
    );
  });

  it('measures nobody’s spend against the organization’s and the key’s caps alone', async () => {
    await checkImageGenerationBudget(sql, {
      ...ARGS,
      subject: { userId: '__automation__', apiKeyId: 'key_1' },
      images: 1,
    });
    expect(mocks.loadBudgetSubject).not.toHaveBeenCalled();
    expect(mocks.findBudgetViolation).toHaveBeenCalledWith(
      sql,
      {
        organizationId: 'org_1',
        userId: '__automation__',
        userTeamIds: [],
        impersonal: true,
        apiKeyId: 'key_1',
      },
      expect.objectContaining({ prospectiveRequests: 0 }),
    );
  });

  it('refuses a reached cap with the gate’s own sentence', async () => {
    mocks.findBudgetViolation.mockResolvedValue({
      scope: 'user',
      code: 'COST_LIMIT',
      period: 'monthly',
      used: 5000,
      limit: 5000,
      reason: 'Cost limit reached',
      resetsAt: Date.UTC(2026, 9, 1),
    });
    await expect(checkImageGenerationBudget(sql, ARGS)).resolves.toEqual({
      allowed: false,
      message:
        'Usage limit reached. Your monthly cost limit is used up until 2026-10-01T00:00:00.000Z.',
    });
  });
});

describe('recordImageGenerationUsage', () => {
  it('books the image under the turn’s person, agent and key', async () => {
    await recordImageGenerationUsage(sql, {
      organizationId: 'org_1',
      subject: { userId: 'user_api', agentSlug: 'agent_1', apiKeyId: 'key_1' },
      provider: 'openai',
      model: 'gpt-image-1',
      inputTokens: 1050,
      outputTokens: 4160,
      costCents: 17.665,
      timestamp: 1_790_000_000_000,
    });
    expect(mocks.incrementUsageLedger).toHaveBeenCalledWith(sql, {
      organizationId: 'org_1',
      userId: 'user_api',
      agentSlug: 'agent_1',
      apiKeyId: 'key_1',
      provider: 'openai',
      model: 'gpt-image-1',
      inputTokens: 1050,
      outputTokens: 4160,
      costEstimateCents: 17.665,
      timestamp: 1_790_000_000_000,
    });
  });

  it('answers the tool dispatch through the shim names it addresses', async () => {
    const handlers = imageGenerationShimHandlers(sql);
    expect(Object.keys(handlers).sort()).toEqual([
      'sandbox/image_generation:checkImageGenerationBudget',
      'sandbox/image_generation:getImageTurnContext',
      'sandbox/image_generation:recordImageGenerationUsage',
    ]);
    await expect(
      handlers['sandbox/image_generation:recordImageGenerationUsage']?.({
        organizationId: 'org_1',
        subject: { userId: 'user_1' },
        provider: 'openrouter',
        model: 'google/gemini-2.5-flash-image',
        inputTokens: 0,
        outputTokens: 0,
        costCents: 3.9,
        timestamp: 1,
      }),
    ).resolves.toBeNull();
  });
});
