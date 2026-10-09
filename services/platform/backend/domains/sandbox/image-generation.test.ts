/**
 * The Postgres seams of `generate_image`: which turn a token's op is (and
 * whether its run still runs), the admission that runs before any provider
 * call — one generation in flight per turn, the per-turn image ceiling, the
 * turn's spend allowance shared with its model spend, and the budget caps
 * with every hold in flight counted, the turn's own included — and the
 * settle that books what the call cost and releases its hold. SQL, the
 * attribution resolver, the budget gate, the holds and the gateway's spend
 * read are stubbed; their own suites cover them, and the integration check
 * drives the admission on a real schema, racing calls included.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  attribution: vi.fn(),
  loadBudgetSubject: vi.fn(),
  findBudgetViolation: vi.fn(),
  lockBudgetAdmission: vi.fn(),
  readInFlightReservations: vi.fn(),
  incrementUsageLedger: vi.fn(),
  readVirtualKeySpend: vi.fn(),
  setVirtualKeyBudget: vi.fn(),
}));

vi.mock('./op-attribution.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./op-attribution.ts')>()),
  resolveSessionOpAttribution: mocks.attribution,
}));
vi.mock('../governance/budget-gate.ts', () => ({
  loadBudgetSubject: mocks.loadBudgetSubject,
  findBudgetViolation: mocks.findBudgetViolation,
}));
vi.mock('../governance/budget-reservations.ts', () => ({
  lockBudgetAdmission: mocks.lockBudgetAdmission,
  readInFlightReservations: mocks.readInFlightReservations,
}));
vi.mock('../governance/service.ts', () => ({
  incrementUsageLedger: mocks.incrementUsageLedger,
}));
vi.mock('../../core/node_only/sandbox/llm_gateway_admin.ts', () => ({
  readVirtualKeySpend: mocks.readVirtualKeySpend,
  setVirtualKeyBudget: mocks.setVirtualKeyBudget,
}));

const {
  admitImageGeneration,
  imageGenerationShimHandlers,
  resolveImageTurnContext,
  settleImageGeneration,
} = await import('./image-generation.ts');

interface Statement {
  text: string;
  values: unknown[];
}

/** A scripted `sql`: every statement is recorded, and answered with the
 * rows of the first matcher its text contains. */
function scriptedSql(answers: Array<{ match: string; rows: unknown[] }>) {
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
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a scripted stand-in for the tagged template
  return { sql: sql as unknown as Sql, statements };
}

const NOW = 1_790_000_000_000;

/** The op row of a running turn, as the admission reads it. */
function opRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'op_1',
    status: 'running',
    finalized: false,
    mintedKeyId: null,
    budgetCents: 500,
    callStartedAt: null,
    imagesAdmitted: 0,
    imageSpentCents: 0,
    ...overrides,
  };
}

function opSql(overrides: Record<string, unknown> = {}) {
  return scriptedSql([
    { match: 'FROM app.sandbox_session_ops', rows: [opRow(overrides)] },
  ]);
}

const ADMIT = {
  organizationId: 'org_1',
  sessionId: 'pa-alice',
  execId: 'exec_1',
  subject: { userId: 'user_starter', agentSlug: 'agent_1' },
  images: 3,
};

const deps = { now: () => NOW };

function holdWrite(statements: Statement[]): Statement | undefined {
  return statements.find((s) =>
    s.text.includes('SET image_call_started_at_ms'),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.TALE_AUTOMATION_AGENT_BUDGET_CENTS;
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
  mocks.lockBudgetAdmission.mockResolvedValue(undefined);
  mocks.readInFlightReservations.mockResolvedValue({ org: undefined });
  mocks.findBudgetViolation.mockResolvedValue(null);
  mocks.incrementUsageLedger.mockResolvedValue(undefined);
  mocks.readVirtualKeySpend.mockResolvedValue({ status: 'ok', cents: 0 });
  mocks.setVirtualKeyBudget.mockResolvedValue('ok');
});

describe('resolveImageTurnContext', () => {
  it('keeps admitted projects while retaining live-run authorization [GOV-R14]', async () => {
    const { sql } = scriptedSql([
      { match: 'FROM app.project_agent_runs', rows: [{ taskId: 'task_1' }] },
      {
        match: 'FROM app.sandbox_session_ops',
        rows: [{ projectIds: ['original-project'] }],
      },
    ]);
    mocks.attribution.mockResolvedValue({
      userId: 'user_starter',
      projectIds: ['new-project'],
    });
    await expect(
      resolveImageTurnContext(sql, {
        organizationId: 'org_1',
        sessionId: 'pa-alice',
        kind: 'task-agent',
        execId: 'exec_1',
      }),
    ).resolves.toMatchObject({
      status: 'live',
      subject: { projectIds: ['original-project'] },
    });
  });

  it('delivers a live task run into its task’s own box, for its starter', async () => {
    const { sql, statements } = scriptedSql([
      { match: 'FROM app.project_agent_runs', rows: [{ taskId: 'task_1' }] },
    ]);
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
    const { sql, statements } = scriptedSql([
      { match: 'FROM app.sandbox_session_ops', rows: [{ id: 'op_1' }] },
    ]);
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
    expect(statements[0]?.text).toContain("status = 'running'");
    expect(statements[0]?.text).toContain('finalized_at_ms IS NULL');
  });

  it.each(['task-agent', 'workflow-agent'] as const)(
    'reads a %s turn whose run has ended as ended, naming nobody',
    async (kind) => {
      const { sql } = scriptedSql([]);
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

  it('names the project the turn’s run is in [GOV-R14]', async () => {
    const { sql } = scriptedSql([
      { match: 'FROM app.project_agent_runs', rows: [{ taskId: 'task_1' }] },
    ]);
    mocks.attribution.mockResolvedValue({
      userId: '__automation__',
      agentSlug: 'agent_1',
      projectIds: ['project_1'],
    });
    await expect(
      resolveImageTurnContext(sql, {
        organizationId: 'org_1',
        sessionId: 'pa-alice',
        kind: 'task-agent',
        execId: 'exec_1',
      }),
    ).resolves.toMatchObject({
      subject: { userId: '__automation__', projectIds: ['project_1'] },
    });
  });

  it('books a run nobody started under the automation sentinel', async () => {
    const { sql } = scriptedSql([
      { match: 'FROM app.project_agent_runs', rows: [{ taskId: 'task_1' }] },
    ]);
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

describe('admitImageGeneration', () => {
  it.each([{ projectIds: ['original-project'] }, { projectIds: [] }])(
    'checks the projects held by the op even with stale image context: $projectIds [GOV-R14]',
    async ({ projectIds }) => {
      const { sql, statements } = opSql({ projectIds });
      const result = await admitImageGeneration(
        sql,
        {
          ...ADMIT,
          subject: { ...ADMIT.subject, projectIds: ['new-project'] },
        },
        deps,
      );
      expect(result.admitted).toBe(true);
      expect(mocks.findBudgetViolation).toHaveBeenCalledWith(
        sql,
        expect.objectContaining({ projectIds }),
        expect.anything(),
      );
      expect(holdWrite(statements)?.values).toContainEqual(projectIds);
      expect(holdWrite(statements)?.values).not.toContainEqual(['new-project']);
    },
  );

  it('admits under every bound, holding the estimate on the op row', async () => {
    const { sql, statements } = opSql();
    await expect(admitImageGeneration(sql, ADMIT, deps)).resolves.toEqual({
      admitted: true,
      callStartedAt: NOW,
      holdCents: 75,
    });
    // Under the lock every budget admission of the organization takes,
    // then the op row's own.
    expect(mocks.lockBudgetAdmission).toHaveBeenCalledWith(sql, 'org_1');
    expect(
      statements.some(
        (s) => s.text.includes('WHERE id = ?') && s.text.includes('FOR UPDATE'),
      ),
    ).toBe(true);
    // The person as they are now, measured against every hold in flight —
    // this turn's own included: no exclusion is passed.
    expect(mocks.loadBudgetSubject).toHaveBeenCalledWith(sql, {
      organizationId: 'org_1',
      userId: 'user_starter',
    });
    expect(mocks.readInFlightReservations).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({ userTeamIds: ['team_1'] }),
    );
    expect(mocks.readInFlightReservations.mock.calls[0]).toHaveLength(2);
    expect(mocks.findBudgetViolation).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({ userId: 'user_starter' }),
      {
        reservations: { org: undefined },
        prospectiveCostCents: 75,
        prospectiveRequests: 2,
      },
    );
    const write = holdWrite(statements);
    expect(write?.text).toContain('image_hold_cents = ?');
    expect(write?.text).toContain('image_hold_requests = ?');
    expect(write?.text).toContain('images_admitted = images_admitted + ?');
    expect(write?.text).toContain('user_id = coalesce(user_id, ?)');
    // A turn outside any project holds its images in none.
    expect(write?.values).toEqual([NOW, 75, 3, 3, 'user_starter', [], 'op_1']);
  });

  it('measures the images against what the allowance has left after the model’s live spend', async () => {
    const { sql, statements } = opSql({
      mintedKeyId: 'vk_1',
      imageSpentCents: 100,
    });
    mocks.readVirtualKeySpend.mockResolvedValue({ status: 'ok', cents: 330 });
    // 500 − 330 − 100 leaves 70: three images held at 75 do not fit.
    await expect(admitImageGeneration(sql, ADMIT, deps)).resolves.toEqual({
      admitted: false,
      code: 'turn_allowance',
      message:
        "This turn's spend allowance has 70 cents left, and 3 images are held at 75 cents until their cost is known.",
    });
    expect(mocks.readVirtualKeySpend).toHaveBeenCalledWith('vk_1');
    // The gateway is read before the lock, never while holding it.
    expect(mocks.readVirtualKeySpend.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.lockBudgetAdmission.mock.invocationCallOrder[0] ?? 0,
    );
    expect(holdWrite(statements)).toBeUndefined();
    // Two images fit: 50 of the 70 left.
    await expect(
      admitImageGeneration(sql, { ...ADMIT, images: 2 }, deps),
    ).resolves.toMatchObject({ admitted: true, holdCents: 50 });
  });

  it("sets the images' hold aside from the key's cap before any provider is called", async () => {
    const { sql } = opSql({ mintedKeyId: 'vk_1', imageSpentCents: 100 });
    mocks.readVirtualKeySpend.mockResolvedValue({ status: 'ok', cents: 330 });
    await expect(
      admitImageGeneration(sql, { ...ADMIT, images: 2 }, deps),
    ).resolves.toMatchObject({ admitted: true, holdCents: 50 });
    // The model keeps what the allowance has left once the images booked
    // and held are out of it: 500 − 100 − 50. Its own 330 stays counted
    // on the key.
    expect(mocks.setVirtualKeyBudget).toHaveBeenCalledWith('vk_1', 350);
  });

  it('takes the admission back when the cap cannot be moved', async () => {
    const { sql, statements } = opSql({ mintedKeyId: 'vk_1' });
    mocks.setVirtualKeyBudget.mockRejectedValueOnce(new Error('gateway down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(admitImageGeneration(sql, ADMIT, deps)).resolves.toEqual({
      admitted: false,
      code: 'spend_unknown',
      message:
        "The platform could not set the images' cost aside from this turn's spend allowance, so it cannot generate them now.",
    });
    expect(warn).toHaveBeenCalled();
    const withdraw = statements.find((s) =>
      s.text.includes('images_admitted = greatest(0, images_admitted - ?)'),
    );
    // Only this admission's own mark: a newer call's is left alone.
    expect(withdraw?.text).toContain(
      'WHERE id = ? AND image_call_started_at_ms = ?',
    );
    expect(withdraw?.values).toEqual([3, 'op_1', NOW]);

    // A key the gateway no longer holds: the turn is over.
    const gone = opSql({ mintedKeyId: 'vk_1' });
    mocks.setVirtualKeyBudget.mockResolvedValueOnce('gone');
    await expect(
      admitImageGeneration(gone.sql, ADMIT, deps),
    ).resolves.toMatchObject({ admitted: false, code: 'run_ended' });
    expect(
      gone.statements.some((s) =>
        s.text.includes('images_admitted = greatest(0, images_admitted - ?)'),
      ),
    ).toBe(true);
  });

  it.each([
    ['one that reserved nothing', null],
    ['one holding its request at no cost [GOV-R16]', 0],
  ])(
    'measures a subscription turn — %s — against the deployment’s default allowance',
    async (_label, budgetCents) => {
      const { sql } = opSql({ budgetCents, imageSpentCents: 450 });
      await expect(
        admitImageGeneration(sql, ADMIT, deps),
      ).resolves.toMatchObject({ admitted: false, code: 'turn_allowance' });
      await expect(
        admitImageGeneration(sql, { ...ADMIT, images: 2 }, deps),
      ).resolves.toMatchObject({ admitted: true });
      // Its model spend is the vendor's: no gateway key to read, or to cap.
      expect(mocks.readVirtualKeySpend).not.toHaveBeenCalled();
      expect(mocks.setVirtualKeyBudget).not.toHaveBeenCalled();

      process.env.TALE_AUTOMATION_AGENT_BUDGET_CENTS = '1000';
      await expect(
        admitImageGeneration(sql, ADMIT, deps),
      ).resolves.toMatchObject({ admitted: true });
    },
  );

  it('refuses a second call while one is in flight, and takes over one whose process died', async () => {
    const running = opSql({ callStartedAt: NOW - 60_000 });
    await expect(
      admitImageGeneration(running.sql, ADMIT, deps),
    ).resolves.toEqual({
      admitted: false,
      code: 'generation_in_progress',
      message: 'Another image generation of this turn is still running.',
    });
    expect(holdWrite(running.statements)).toBeUndefined();

    const stale = opSql({ callStartedAt: NOW - 11 * 60_000 });
    await expect(
      admitImageGeneration(stale.sql, ADMIT, deps),
    ).resolves.toMatchObject({ admitted: true });
  });

  it('stops at the per-turn ceiling, saying what is left', async () => {
    const { sql } = opSql({ imagesAdmitted: 14 });
    await expect(admitImageGeneration(sql, ADMIT, deps)).resolves.toEqual({
      admitted: false,
      code: 'turn_image_limit',
      message: 'This turn may create 2 more images (16 per turn), not 3.',
    });
    await expect(
      admitImageGeneration(sql, { ...ADMIT, images: 2 }, deps),
    ).resolves.toMatchObject({ admitted: true });

    const spent = opSql({ imagesAdmitted: 16 });
    await expect(
      admitImageGeneration(spent.sql, { ...ADMIT, images: 1 }, deps),
    ).resolves.toEqual({
      admitted: false,
      code: 'turn_image_limit',
      message: 'This turn has created the 16 images one turn may create.',
    });
  });

  it('refuses a reached cap with the gate’s own sentence and holds nothing [SBX-R16]', async () => {
    const { sql, statements } = opSql();
    mocks.findBudgetViolation.mockResolvedValue({
      scope: 'user',
      code: 'COST_LIMIT',
      period: 'monthly',
      used: 5000,
      limit: 5000,
      reason: 'Cost limit reached',
      resetsAt: Date.UTC(2026, 9, 1),
    });
    await expect(admitImageGeneration(sql, ADMIT, deps)).resolves.toEqual({
      admitted: false,
      code: 'budget_exceeded',
      message:
        'Usage limit reached. Your monthly cost limit is used up until 2026-10-01T00:00:00.000Z.',
    });
    expect(holdWrite(statements)).toBeUndefined();
  });

  it('measures nobody’s spend against the organization’s and the key’s caps alone', async () => {
    const { sql, statements } = opSql();
    await admitImageGeneration(
      sql,
      {
        ...ADMIT,
        subject: { userId: '__automation__', apiKeyId: 'key_1' },
        images: 1,
      },
      deps,
    );
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
      expect.objectContaining({
        prospectiveCostCents: 25,
        prospectiveRequests: 0,
      }),
    );
    expect(holdWrite(statements)?.values).toContain('__automation__');
  });

  it('holds the images in the turn’s project, on an op its reservation did not stamp [GOV-R14]', async () => {
    const { sql, statements } = opSql();
    await admitImageGeneration(
      sql,
      {
        ...ADMIT,
        subject: { userId: 'user_starter', projectIds: ['project_1'] },
      },
      deps,
    );
    const hold = holdWrite(statements);
    expect(hold?.text).toContain('project_ids = coalesce( project_ids, ? )');
    expect(hold?.values).toContainEqual(['project_1']);
  });

  it('holds an image in a project to the project’s caps, whoever the turn is for [GOV-R14]', async () => {
    for (const subject of [
      { userId: 'user_starter', projectIds: ['project_1'] },
      { userId: '__automation__', projectIds: ['project_1'] },
    ]) {
      mocks.findBudgetViolation.mockClear();
      const { sql } = opSql();
      await admitImageGeneration(sql, { ...ADMIT, subject, images: 1 }, deps);
      expect(mocks.findBudgetViolation).toHaveBeenCalledWith(
        sql,
        expect.objectContaining({ projectIds: ['project_1'] }),
        expect.anything(),
      );
    }
  });

  it.each([
    ['the op is gone', [] as unknown[]],
    ['the op has ended', [opRow({ status: 'completed' })]],
    ['the op is finalized', [opRow({ finalized: true })]],
  ])('refuses a turn that is over: %s', async (_label, rows) => {
    const { sql } = scriptedSql([
      { match: 'FROM app.sandbox_session_ops', rows },
    ]);
    await expect(admitImageGeneration(sql, ADMIT, deps)).resolves.toMatchObject(
      { admitted: false, code: 'run_ended' },
    );
    expect(mocks.lockBudgetAdmission).not.toHaveBeenCalled();
  });

  it('refuses when the model spend cannot be read, and ends with a key that is gone', async () => {
    const { sql } = opSql({ mintedKeyId: 'vk_1' });
    mocks.readVirtualKeySpend.mockResolvedValueOnce({ status: 'unavailable' });
    await expect(admitImageGeneration(sql, ADMIT, deps)).resolves.toMatchObject(
      { admitted: false, code: 'spend_unknown' },
    );
    mocks.readVirtualKeySpend.mockResolvedValueOnce({
      status: 'ok',
      cents: 0,
      unmetered: true,
    });
    await expect(admitImageGeneration(sql, ADMIT, deps)).resolves.toMatchObject(
      { admitted: false, code: 'spend_unknown' },
    );
    mocks.readVirtualKeySpend.mockResolvedValueOnce({ status: 'gone' });
    await expect(admitImageGeneration(sql, ADMIT, deps)).resolves.toMatchObject(
      { admitted: false, code: 'run_ended' },
    );
    expect(mocks.lockBudgetAdmission).not.toHaveBeenCalled();
  });
});

describe('settleImageGeneration', () => {
  it.each([{ projectIds: ['original-project'] }, { projectIds: [] }])(
    'books the admitted projects after bindings changed during provider work: $projectIds [GOV-R14]',
    async ({ projectIds }) => {
      const { sql } = opSql({ projectIds });
      await settleImageGeneration(sql, {
        organizationId: 'org_1',
        sessionId: 'pa-alice',
        execId: 'exec_1',
        callStartedAt: NOW,
        subject: { ...ADMIT.subject, projectIds: ['new-project'] },
        provider: 'provider',
        model: 'model',
        charges: [5],
        timestamp: NOW,
      });
      expect(mocks.incrementUsageLedger).toHaveBeenCalledWith(
        sql,
        expect.objectContaining({ projectIds, costEstimateCents: 5 }),
      );
    },
  );

  const SETTLE = {
    organizationId: 'org_1',
    sessionId: 'pa-alice',
    execId: 'exec_1',
    callStartedAt: NOW,
    subject: { userId: 'user_api', agentSlug: 'agent_1', apiKeyId: 'key_1' },
    provider: 'openrouter',
    model: 'google/gemini-2.5-flash-image',
    timestamp: NOW + 5_000,
  };

  it('books every charged request with no tokens, adds the cost to the turn and releases its own hold', async () => {
    const { sql, statements } = scriptedSql([]);
    await settleImageGeneration(sql, { ...SETTLE, charges: [3.9, 0] });
    expect(mocks.incrementUsageLedger).toHaveBeenCalledTimes(2);
    expect(mocks.incrementUsageLedger).toHaveBeenNthCalledWith(1, sql, {
      organizationId: 'org_1',
      userId: 'user_api',
      agentSlug: 'agent_1',
      apiKeyId: 'key_1',
      provider: 'openrouter',
      model: 'google/gemini-2.5-flash-image',
      inputTokens: 0,
      outputTokens: 0,
      costEstimateCents: 3.9,
      timestamp: NOW + 5_000,
    });
    expect(mocks.incrementUsageLedger).toHaveBeenNthCalledWith(
      2,
      sql,
      expect.objectContaining({ costEstimateCents: 0 }),
    );
    const release = statements.find((s) =>
      s.text.includes('image_spent_cents = image_spent_cents + ?'),
    );
    // Only this call's own hold is released: a call whose mark was taken
    // over as stale leaves the newer one alone.
    expect(release?.text).toContain(
      'WHEN image_call_started_at_ms = ? THEN NULL',
    );
    expect(release?.values).toEqual([
      3.9,
      NOW,
      NOW,
      NOW,
      'org_1',
      'pa-alice',
      'exec_1',
    ]);
  });

  it('books an image in a project to the project too [GOV-R14]', async () => {
    const { sql } = scriptedSql([]);
    await settleImageGeneration(sql, {
      ...SETTLE,
      subject: { ...SETTLE.subject, projectIds: ['project_1'] },
      charges: [3.9],
    });
    expect(mocks.incrementUsageLedger).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({
        projectIds: ['project_1'],
        costEstimateCents: 3.9,
      }),
    );
  });

  it("moves the key's cap to the allowance less every image booked or still held", async () => {
    const { sql } = scriptedSql([
      {
        match: 'RETURNING minted_key_id',
        rows: [
          {
            mintedKeyId: 'vk_1',
            budgetCents: 500,
            imageSpentCents: 103.9,
            imageHoldCents: 25,
          },
        ],
      },
    ]);
    await settleImageGeneration(sql, { ...SETTLE, charges: [3.9] });
    expect(mocks.setVirtualKeyBudget).toHaveBeenCalledWith('vk_1', 371.1);
  });

  it('books the images even when the cap cannot be moved', async () => {
    const { sql } = scriptedSql([
      {
        match: 'RETURNING minted_key_id',
        rows: [
          {
            mintedKeyId: 'vk_1',
            budgetCents: 500,
            imageSpentCents: 3.9,
            imageHoldCents: 0,
          },
        ],
      },
    ]);
    mocks.setVirtualKeyBudget.mockRejectedValueOnce(new Error('gateway down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(
      settleImageGeneration(sql, { ...SETTLE, charges: [3.9] }),
    ).resolves.toBeUndefined();
    expect(mocks.incrementUsageLedger).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
  });

  it('leaves a subscription turn without a key uncapped by the settle', async () => {
    const { sql } = scriptedSql([
      {
        match: 'RETURNING minted_key_id',
        rows: [
          {
            mintedKeyId: null,
            budgetCents: null,
            imageSpentCents: 3.9,
            imageHoldCents: 0,
          },
        ],
      },
    ]);
    await settleImageGeneration(sql, { ...SETTLE, charges: [3.9] });
    expect(mocks.setVirtualKeyBudget).not.toHaveBeenCalled();
  });

  it('releases the hold with nothing to book when nothing was billed', async () => {
    const { sql, statements } = scriptedSql([]);
    await settleImageGeneration(sql, { ...SETTLE, charges: [] });
    expect(mocks.incrementUsageLedger).not.toHaveBeenCalled();
    expect(statements).toHaveLength(1);
    expect(statements[0]?.values[0]).toBe(0);
  });
});

describe('imageGenerationShimHandlers', () => {
  it('answers the tool dispatch through the names it addresses', async () => {
    const { sql } = scriptedSql([]);
    const handlers = imageGenerationShimHandlers(sql);
    expect(Object.keys(handlers).sort()).toEqual([
      'sandbox/image_generation:admitImageGeneration',
      'sandbox/image_generation:getImageTurnContext',
      'sandbox/image_generation:settleImageGeneration',
    ]);
    await expect(
      handlers['sandbox/image_generation:settleImageGeneration']?.({
        organizationId: 'org_1',
        sessionId: 'pa-alice',
        execId: 'exec_1',
        callStartedAt: NOW,
        subject: { userId: 'user_1' },
        provider: 'openrouter',
        model: 'google/gemini-2.5-flash-image',
        charges: [3.9],
        timestamp: 1,
      }),
    ).resolves.toBeNull();
  });
});
