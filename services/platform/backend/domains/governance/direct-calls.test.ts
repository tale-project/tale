/**
 * A direct provider call holds its worst case on an op row while it runs
 * and is booked in the hold's place once it ends — or, while no budget
 * binds its organization, is recorded on a row that holds nothing and
 * booked from that. The reservation itself (`reserveTurnBudget`) and the
 * ledger writer are stand-ins; the SQL is scripted. The real-Postgres proof
 * is the project-budget lane.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTOMATION_SUBJECT_ID } from '../../../lib/shared/constants/usage.ts';

const mocks = vi.hoisted(() => ({
  budgetPolicyActive: vi.fn(),
  findBudgetViolation: vi.fn(),
  loadAttributedBudgetSubject: vi.fn(),
  readInFlightReservations: vi.fn(),
  reserveTurnBudget: vi.fn(),
  incrementUsageLedger: vi.fn(async () => undefined),
  estimateTurnCostCents: vi.fn(async () => 0),
}));

vi.mock('./budget-gate.ts', () => ({
  budgetPolicyActive: mocks.budgetPolicyActive,
  findBudgetViolation: mocks.findBudgetViolation,
}));
vi.mock('./attributed-subject.ts', () => ({
  loadAttributedBudgetSubject: mocks.loadAttributedBudgetSubject,
}));
vi.mock('./budget-reservations.ts', () => ({
  readInFlightReservations: mocks.readInFlightReservations,
}));
vi.mock('../sandbox/turn-budget.ts', () => ({
  reserveTurnBudget: mocks.reserveTurnBudget,
}));
vi.mock('./service.ts', () => ({
  incrementUsageLedger: mocks.incrementUsageLedger,
}));
vi.mock('../chat/store.ts', () => ({
  estimateTurnCostCents: mocks.estimateTurnCostCents,
}));

const {
  directCallBlocked,
  isDirectCallLease,
  openDirectCall,
  openTokenCall,
  releaseDirectCall,
  releaseStaleDirectCalls,
  settleDirectCall,
  settleTokenCall,
  sweepSettledDirectCalls,
} = await import('./direct-calls.ts');

interface Statement {
  text: string;
  values: unknown[];
}

function fakeSql(answer: (text: string) => unknown[] = () => []) {
  const statements: Statement[] = [];
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    return Promise.resolve(answer(text));
  };
  const sql = Object.assign(run, {
    begin: async (fn: (tx: unknown) => Promise<unknown>) => fn(sql),
  });
  return { sql: sql as unknown as Sql, statements };
}

const SUBJECT = {
  userId: 'user-1',
  agentSlug: 'inbox-improve',
  apiKeyId: 'key-1',
  projectIds: ['project-1'],
};
const OPEN = {
  organizationId: 'org-1',
  lane: 'improve',
  subject: SUBJECT,
  worstCase: { cents: 2.2, tokens: 3_000 },
  modelRef: 'openai/gpt-5-mini',
  maxDurationMs: 60_000,
};
const SPEND = {
  provider: 'openai',
  model: 'gpt-5-mini',
  inputTokens: 900,
  outputTokens: 150,
  costCents: 0.4,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.budgetPolicyActive.mockResolvedValue(true);
  mocks.reserveTurnBudget.mockResolvedValue({ allowed: true, budgetCents: 3 });
});

describe('openDirectCall [GOV-R5]', () => {
  it('holds the worst case whole, in whole cents, under the call’s subject', async () => {
    const { sql } = fakeSql();
    const admission = await openDirectCall(sql, OPEN);

    expect(admission).toMatchObject({
      allowed: true,
      lease: {
        organizationId: 'org-1',
        sessionId: 'direct-call:improve',
        execId: expect.any(String),
        subject: SUBJECT,
      },
    });
    expect(mocks.reserveTurnBudget).toHaveBeenCalledWith(sql, {
      organizationId: 'org-1',
      sessionId: 'direct-call:improve',
      execId: expect.any(String),
      kind: 'direct-call',
      defaultBudgetCents: 3,
      modelRef: 'openai/gpt-5-mini',
      subject: SUBJECT,
      whole: { prospectiveTokens: 3_000 },
      deadlineAtMs: expect.any(Number),
    });
  });

  it('records a call that holds nothing while no budget binds the organization', async () => {
    mocks.budgetPolicyActive.mockResolvedValue(false);
    const { sql, statements } = fakeSql();

    const admission = await openDirectCall(sql, OPEN);
    expect(admission).toMatchObject({
      allowed: true,
      lease: { sessionId: 'direct-call:improve', subject: SUBJECT },
    });
    expect(mocks.reserveTurnBudget).not.toHaveBeenCalled();
    // A row with no `budget_cents`: no admission counts it, and the settle
    // books from it like any other.
    expect(statements).toHaveLength(1);
    expect(statements[0]?.text).toContain(
      'INSERT INTO app.sandbox_session_ops ( org_id, session_id, exec_id, kind, status, user_id, agent_slug, api_key_id, project_ids, model_ref, deadline_ms, heartbeat_at_ms, started_at_ms )',
    );
    if (!admission.allowed) throw new Error('admitted');
    expect(statements[0]?.values).toEqual([
      'org-1',
      'direct-call:improve',
      admission.lease.execId,
      'direct-call',
      'user-1',
      'inbox-improve',
      'key-1',
      ['project-1'],
      'openai/gpt-5-mini',
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    ]);
  });

  it('refuses a call whose worst case a cap has no room for, in the cap’s own words [GOV-R4]', async () => {
    mocks.reserveTurnBudget.mockResolvedValue({
      allowed: false,
      reason:
        'This project’s monthly spend cap leaves too little for this request.',
      violation: {
        scope: 'project',
        projectId: 'project-1',
        code: 'COST_LIMIT',
        period: 'monthly',
        used: 99,
        limit: 100,
        reason: 'x',
        resetsAt: Date.UTC(2026, 10, 1),
      },
    });

    await expect(openDirectCall(fakeSql().sql, OPEN)).resolves.toMatchObject({
      allowed: false,
      reason:
        "Usage limit reached. This project's monthly cost limit leaves too little for this request until 2026-11-01T00:00:00.000Z.",
    });
  });
});

describe('settleDirectCall', () => {
  it('books under the op row’s stamp and closes the hold, once', async () => {
    const { sql, statements } = fakeSql((text) =>
      text.startsWith('UPDATE app.sandbox_session_ops')
        ? [
            {
              userId: 'user-1',
              agentSlug: 'inbox-improve',
              apiKeyId: 'key-1',
              projectIds: ['project-1'],
            },
          ]
        : [],
    );
    const lease = {
      organizationId: 'org-1',
      sessionId: 'direct-call:improve',
      execId: 'exec-1',
      subject: SUBJECT,
    };

    await expect(settleDirectCall(sql, lease, SPEND)).resolves.toBe('settled');

    // The booked figure is the gate: a hold the watchdog already released
    // is still booked once its call ends.
    expect(statements[0]?.text).toContain('AND spent_cents IS NULL');
    expect(mocks.incrementUsageLedger).toHaveBeenCalledWith(sql, {
      organizationId: 'org-1',
      userId: 'user-1',
      apiKeyId: 'key-1',
      agentSlug: 'inbox-improve',
      projectIds: ['project-1'],
      model: 'gpt-5-mini',
      provider: 'openai',
      inputTokens: 900,
      outputTokens: 150,
      costEstimateCents: 0.4,
      timestamp: expect.any(Number),
    });

    const replay = fakeSql();
    await expect(settleDirectCall(replay.sql, lease, SPEND)).resolves.toBe(
      'already_settled',
    );
    expect(mocks.incrementUsageLedger).toHaveBeenCalledTimes(1);
  });

  it('books an unheld call from its row too — once, under whoever the row names now', async () => {
    // An erasure that ran mid-call left the row under the pseudonym.
    const { sql } = fakeSql((text) =>
      text.startsWith('UPDATE app.sandbox_session_ops')
        ? [
            {
              userId: 'erased-user',
              agentSlug: 'thread-title',
              apiKeyId: null,
              projectIds: null,
            },
          ]
        : [],
    );
    const lease = {
      organizationId: 'org-1',
      sessionId: 'direct-call:title',
      execId: 'exec-1',
      subject: { userId: 'user-1', agentSlug: 'thread-title' },
    };
    await expect(settleDirectCall(sql, lease, SPEND)).resolves.toBe('settled');
    expect(mocks.incrementUsageLedger).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({
        userId: 'erased-user',
        agentSlug: 'thread-title',
        costEstimateCents: 0.4,
      }),
    );
    // Its row deleted (the erasure removed a finished one) books nothing.
    await expect(settleDirectCall(fakeSql().sql, lease, SPEND)).resolves.toBe(
      'already_settled',
    );
    expect(mocks.incrementUsageLedger).toHaveBeenCalledTimes(1);
  });

  it('books a row that names nobody as the organization’s', async () => {
    const { sql } = fakeSql((text) =>
      text.startsWith('UPDATE app.sandbox_session_ops')
        ? [
            {
              userId: null,
              agentSlug: null,
              apiKeyId: null,
              projectIds: null,
            },
          ]
        : [],
    );
    await settleDirectCall(
      sql,
      {
        organizationId: 'org-1',
        sessionId: 'direct-call:title',
        execId: 'exec-1',
        subject: { userId: AUTOMATION_SUBJECT_ID, agentSlug: 'thread-title' },
      },
      SPEND,
    );
    expect(mocks.incrementUsageLedger).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({ userId: AUTOMATION_SUBJECT_ID }),
    );
  });
});

describe('releasing holds', () => {
  it('closes an unsettled call’s row without a booking', async () => {
    const held = fakeSql();
    await releaseDirectCall(held.sql, {
      organizationId: 'org-1',
      sessionId: 'direct-call:improve',
      execId: 'exec-1',
      subject: SUBJECT,
    });
    expect(held.statements[0]?.text).toContain(
      'AND spend_settled_at_ms IS NULL',
    );
    expect(mocks.incrementUsageLedger).not.toHaveBeenCalled();
  });

  it('lets a lost call’s hold lapse at its deadline, and deletes settled rows a day on', async () => {
    const stale = fakeSql(() => [{ id: 'op-1' }, { id: 'op-2' }]);
    await expect(releaseStaleDirectCalls(stale.sql, 1_000_000)).resolves.toBe(
      2,
    );
    expect(stale.statements[0]?.text).toContain(
      "WHERE kind = 'direct-call' AND spend_settled_at_ms IS NULL AND deadline_ms < ?",
    );

    const sweep = fakeSql(() => []);
    await sweepSettledDirectCalls(sweep.sql, { now: 100_000_000 });
    expect(sweep.statements[0]?.text).toContain(
      "WHERE kind = 'direct-call' AND spend_settled_at_ms IS NOT NULL AND started_at_ms < ?",
    );
    expect(sweep.statements[0]?.values).toContain(100_000_000 - 86_400_000);
  });
});

describe('a text model’s call', () => {
  it('holds the prompt and the whole output cap at the catalog price, and books what it reported at that price', async () => {
    mocks.estimateTurnCostCents
      .mockResolvedValueOnce(2.4) // the worst case
      .mockResolvedValueOnce(0.31); // what the call cost
    const { sql } = fakeSql((text) =>
      text.startsWith('UPDATE app.sandbox_session_ops')
        ? [
            {
              userId: 'user-1',
              agentSlug: 'inbox-improve',
              apiKeyId: null,
              projectIds: null,
            },
          ]
        : [],
    );
    const call = {
      organizationId: 'org-1',
      provider: 'openai',
      model: 'gpt-5-mini',
    };

    const admission = await openTokenCall(sql, {
      ...call,
      lane: 'improve',
      subject: SUBJECT,
      promptTokens: 900,
      maxOutputTokens: 1_500,
      maxDurationMs: 60_000,
    });
    expect(mocks.estimateTurnCostCents).toHaveBeenNthCalledWith(1, sql, {
      ...call,
      inputTokens: 900,
      outputTokens: 1_500,
    });
    expect(mocks.reserveTurnBudget).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({
        defaultBudgetCents: 3,
        modelRef: 'openai/gpt-5-mini',
        whole: { prospectiveTokens: 2_400 },
      }),
    );
    if (!admission.allowed) throw new Error('admitted');

    await settleTokenCall(sql, admission.lease, {
      ...call,
      inputTokens: 800,
      outputTokens: 120,
      cachedInputTokens: 600,
    });
    expect(mocks.estimateTurnCostCents).toHaveBeenNthCalledWith(2, sql, {
      ...call,
      inputTokens: 800,
      outputTokens: 120,
      cachedInputTokens: 600,
    });
    expect(mocks.incrementUsageLedger).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({ costEstimateCents: 0.31, inputTokens: 800 }),
    );
  });

  it('knows its own leases off an untyped seam', () => {
    expect(
      isDirectCallLease({
        organizationId: 'o',
        sessionId: 's',
        execId: 'e',
        subject: { userId: 'u', agentSlug: 'a' },
      }),
    ).toBe(true);
    expect(isDirectCallLease({ organizationId: 'o' })).toBe(false);
    expect(isDirectCallLease('lease-1')).toBe(false);
  });
});

describe('directCallBlocked', () => {
  it('reads nothing while no budget binds the organization', async () => {
    mocks.budgetPolicyActive.mockResolvedValue(false);
    await expect(
      directCallBlocked(fakeSql().sql, {
        organizationId: 'org-1',
        subject: SUBJECT,
      }),
    ).resolves.toBeNull();
    expect(mocks.loadAttributedBudgetSubject).not.toHaveBeenCalled();
  });

  it('measures the subject, its key and projects, counting the work in flight, and holds nothing [GOV-R5]', async () => {
    const { sql } = fakeSql();
    const measured = { organizationId: 'org-1', userId: 'user-1' };
    const holds = { user: { costCents: 3, tokens: 0, requests: 1 } };
    const violation = { scope: 'user', code: 'COST_LIMIT' };
    mocks.loadAttributedBudgetSubject.mockResolvedValue(measured);
    mocks.readInFlightReservations.mockResolvedValue(holds);
    mocks.findBudgetViolation.mockResolvedValue(violation);

    await expect(
      directCallBlocked(sql, { organizationId: 'org-1', subject: SUBJECT }),
    ).resolves.toBe(violation);
    expect(mocks.loadAttributedBudgetSubject).toHaveBeenCalledWith(
      sql,
      'org-1',
      SUBJECT,
    );
    expect(mocks.findBudgetViolation).toHaveBeenCalledWith(sql, measured, {
      reservations: holds,
    });
    expect(mocks.reserveTurnBudget).not.toHaveBeenCalled();
  });
});
