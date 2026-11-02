/**
 * The holds of the work in flight, and the admission lock. The SQL runs on a
 * scripted `sql` here — what the holds add up to on a real schema, and that
 * racing admissions cannot both pass a cap, is the integration check's.
 */

import {
  isSerializationFailure,
  retryQueueKeysOf,
} from '@tale/shared/db/serializable';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  budgetAdmissionQueueKey,
  foldBudgetUsage,
  foldPendingBudgetUsage,
  lockBudgetAdmission,
  readInFlightReservations,
} from './budget-reservations.ts';

interface Statement {
  text: string;
  values: unknown[];
}

function scriptedSql(rows: unknown[]) {
  const statements: Statement[] = [];
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    statements.push({ text: strings.join('?').replace(/\s+/g, ' '), values });
    return Promise.resolve(rows);
  };
  return { sql: sql as never, statements };
}

/** A pool whose statements, in and out of its transactions, are answered by
 * `answer` from their text; an `Error` answer rejects. */
function scriptedPool(
  answer: (text: string, values: unknown[]) => unknown[] | Error,
) {
  const statements: Statement[] = [];
  let transactions = 0;
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ');
    statements.push({ text, values });
    const result = answer(text, values);
    return result instanceof Error
      ? Promise.reject(result)
      : Promise.resolve(result);
  };
  const sql = Object.assign(run, {
    begin: (fn: (tx: typeof run) => Promise<unknown>) => {
      transactions += 1;
      return fn(run);
    },
  });
  return { sql: sql as never, statements, transactions: () => transactions };
}

const FOLD = 'DELETE FROM app.usage_period_deltas';

const NO_HOLDS = {
  orgCostCents: 0,
  orgTokens: 0,
  orgRequests: 0,
  userCostCents: 0,
  userTokens: 0,
  userRequests: 0,
  keyCostCents: 0,
  keyTokens: 0,
  keyRequests: 0,
  teams: null,
  projects: null,
};

describe('readInFlightReservations', () => {
  it('answers every bucket the subject is measured in', async () => {
    const { sql, statements } = scriptedSql([
      {
        orgCostCents: 700,
        orgTokens: 9_000,
        orgRequests: 3,
        userCostCents: 200,
        userTokens: 4_000,
        userRequests: 1,
        keyCostCents: 50,
        keyTokens: 1_000,
        keyRequests: 1,
        teams: [
          { teamId: 'team-1', costCents: 450, tokens: 7_000, requests: 2 },
        ],
      },
    ]);

    const reservations = await readInFlightReservations(sql, {
      organizationId: 'org-1',
      userId: 'user-1',
      userTeamIds: ['team-1'],
      apiKeyId: 'key-1',
    });

    expect(reservations).toEqual({
      org: { costCents: 700, tokens: 9_000, requests: 3 },
      user: { costCents: 200, tokens: 4_000, requests: 1 },
      apiKey: { costCents: 50, tokens: 1_000, requests: 1 },
      teams: { 'team-1': { costCents: 450, tokens: 7_000, requests: 2 } },
    });
    // Both kinds of work in flight hold — live chat turns and unsettled
    // managed turns — and a team's holds are its current members'.
    const read = statements[0]?.text ?? '';
    expect(read).toContain('FROM app.generations');
    expect(read).toContain('FROM app.sandbox_session_ops');
    expect(read).toContain('spend_settled_at_ms IS NULL');
    // An unsettled op holds against the key its reservation stamped — a
    // keyed run's turn and a model-endpoint request alike — with the tokens
    // its hold sized and an image generation it has in flight.
    expect(read).toContain(
      "SELECT user_id, api_key_id, coalesce(project_ids, '{}'::text[]), (coalesce(budget_cents, 0) + image_hold_cents)::float8, coalesce(reserved_tokens, 0)::float8,",
    );
    // A team's holds are its current members' and its own keys'.
    expect(read).toContain('FROM "teamMember" tm');
    expect(read).toContain(
      "FROM app.api_key_owners o WHERE o.org_id = ? AND o.owner_kind = 'team'",
    );
    expect(read).toContain('JOIN team_spenders ts ON ts.user_id = h.user_id');
    expect(statements[0]?.values).toEqual(
      expect.arrayContaining(['org-1', 'user-1', 'key-1', ['team-1']]),
    );
  });

  it('holds against a key that is not a person everything its identity holds [APIKEY-R9]', async () => {
    // A run the key's REST comment started holds under the identity without
    // naming the key; it is the key's all the same.
    const { sql, statements } = scriptedSql([NO_HOLDS]);
    await readInFlightReservations(sql, {
      organizationId: 'org-1',
      userId: 'identity-1',
      userTeamIds: [],
      impersonal: true,
      apiKeyId: 'key-1',
      apiKeyIdentity: 'identity-1',
    });
    const read = statements[0]?.text ?? '';
    expect(read).toContain(
      'coalesce(sum(cost_cents) FILTER ( WHERE api_key_id = ? OR user_id = ?), 0)::float8 AS "keyCostCents"',
    );
    const values = statements[0]?.values ?? [];
    expect(values.filter((value) => value === 'identity-1').length).toBe(
      // The user bucket's three filters, and the key bucket's three.
      6,
    );
  });

  it('holds against each project what its threads’ turns and its stamped ops hold [GOV-R14]', async () => {
    const { sql, statements } = scriptedSql([
      {
        ...NO_HOLDS,
        projects: [
          {
            projectId: 'project-1',
            costCents: 120,
            tokens: 3_000,
            requests: 2,
          },
          { projectId: 'project-2', costCents: 40, tokens: 0, requests: 1 },
        ],
      },
    ]);
    const reservations = await readInFlightReservations(sql, {
      organizationId: 'org-1',
      userId: 'user-1',
      userTeamIds: [],
      projectIds: ['project-1', 'project-2'],
    });
    expect(reservations.projects).toEqual({
      'project-1': { costCents: 120, tokens: 3_000, requests: 2 },
      'project-2': { costCents: 40, tokens: 0, requests: 1 },
    });
    const read = statements[0]?.text ?? '';
    // A new chat hold follows its immutable stamp. Legacy NULL still has
    // the previous thread lookup; an empty stamp never falls back.
    expect(read).toContain('coalesce(g.project_ids,');
    expect(read).toContain(
      'LEFT JOIN app.thread_metadata tm ON tm.thread_id = g.thread_id',
    );
    expect(read).toContain("coalesce(project_ids, '{}'::text[])");
    expect(read).toContain(
      'CROSS JOIN LATERAL unnest(h.project_ids) AS p(project_id)',
    );
    expect(statements[0]?.values).toContainEqual(['project-1', 'project-2']);
  });

  it('answers no project hold for work outside a project', async () => {
    const { sql } = scriptedSql([NO_HOLDS]);
    const reservations = await readInFlightReservations(sql, {
      organizationId: 'org-1',
      userId: 'user-1',
      userTeamIds: [],
    });
    expect(reservations).not.toHaveProperty('projects');
  });

  it('adds an image generation in flight to its turn’s hold, one request per image', async () => {
    const { sql, statements } = scriptedSql([NO_HOLDS]);
    await readInFlightReservations(sql, {
      organizationId: 'org-1',
      userId: 'user-1',
      userTeamIds: ['team-1'],
    });
    const read = statements[0]?.text ?? '';
    // A turn holds its allowance plus its generation's estimate — and a
    // subscription turn, which has no allowance, holds while one runs.
    expect(read).toContain(
      '(coalesce(budget_cents, 0) + image_hold_cents)::float8',
    );
    expect(read).toContain(
      '(budget_cents IS NOT NULL OR image_call_started_at_ms IS NOT NULL)',
    );
    // Requests are summed, not counted: a turn is one, each image one more.
    expect(read).toContain(
      '((CASE WHEN budget_cents IS NULL THEN 0 ELSE 1 END) + image_hold_requests)::float8',
    );
    expect(read).toContain('sum(h.requests)::float8 AS "requests"');
    expect(read).toContain(
      'coalesce(sum(requests), 0)::float8 AS "orgRequests"',
    );
    expect(read).not.toContain('count(*)');
  });

  it('leaves the key bucket out of a session request and holds nothing for an idle organization', async () => {
    const { sql } = scriptedSql([NO_HOLDS]);
    await expect(
      readInFlightReservations(sql, {
        organizationId: 'org-1',
        userId: 'user-1',
        userTeamIds: [],
      }),
    ).resolves.toEqual({
      org: { costCents: 0, tokens: 0, requests: 0 },
      user: { costCents: 0, tokens: 0, requests: 0 },
      teams: {},
    });
  });

  it('leaves the admission’s own row out', async () => {
    const { sql, statements } = scriptedSql([NO_HOLDS]);
    await readInFlightReservations(
      sql,
      { organizationId: 'org-1', userId: 'user-1', userTeamIds: [] },
      {
        threadId: 'thread-1',
        op: { sessionId: 'session-1', execId: 'exec-1' },
        tts: { chunkId: 'chunk-1', attemptCreatedAt: 123 },
      },
    );
    expect(statements[0]?.text).toContain('thread_id <> ?');
    expect(statements[0]?.text).toContain(
      'AND NOT (session_id = ? AND exec_id = ?)',
    );
    expect(statements[0]?.values).toEqual(
      expect.arrayContaining([
        'thread-1',
        'session-1',
        'exec-1',
        'chunk-1',
        123,
      ]),
    );
  });
});

describe('lockBudgetAdmission', () => {
  it('takes the queue lock, bumps the organization’s admission row, then folds its usage journal', async () => {
    const { sql, statements } = scriptedSql([]);
    await lockBudgetAdmission(sql, 'org-1');

    expect(statements).toHaveLength(3);
    expect(statements[0]?.text).toContain('pg_advisory_xact_lock');
    expect(statements[0]?.values).toContain(budgetAdmissionQueueKey('org-1'));
    expect(statements[1]?.text).toContain('INSERT INTO app.budget_admissions');
    // The bump is what a stale SERIALIZABLE snapshot conflicts with.
    expect(statements[1]?.text).toContain(
      'ON CONFLICT (org_id) DO UPDATE SET admitted_at_ms',
    );
    // Under the lock, so no other fold of the organization runs beside it.
    expect(statements[2]?.text).toContain(FOLD);
    expect(statements[2]?.values).toContain('org-1');
  });

  it('marks a serialization failure of its fold with the queue key too', async () => {
    const conflict = Object.assign(
      new Error('could not serialize access due to concurrent delete'),
      { code: '40001' },
    );
    const { sql } = scriptedPool((text) =>
      text.includes(FOLD) ? conflict : [],
    );

    const error = await lockBudgetAdmission(sql, 'org-1').catch(
      (caught: unknown) => caught,
    );

    expect(isSerializationFailure(error)).toBe(true);
    expect(retryQueueKeysOf(error)).toEqual(['budget-admission:org-1']);
  });

  it('marks a serialization failure with the queue key, so the retry queues on it', async () => {
    const conflict = Object.assign(
      new Error('could not serialize access due to concurrent update'),
      { code: '40001' },
    );
    const sql = (() => Promise.reject(conflict)) as never;

    const error = await lockBudgetAdmission(sql, 'org-1').catch(
      (caught: unknown) => caught,
    );

    expect(isSerializationFailure(error)).toBe(true);
    expect(retryQueueKeysOf(error)).toEqual(['budget-admission:org-1']);
  });
});

describe('foldBudgetUsage', () => {
  it('folds the organization’s journal in a transaction of its own, under its admission lock', async () => {
    const { sql, statements, transactions } = scriptedPool((text) =>
      text.includes(FOLD) ? [{ deltas: 4, emptiedPeriods: [] }] : [],
    );

    await expect(foldBudgetUsage(sql, 'org-1')).resolves.toBe(4);

    expect(transactions()).toBe(1);
    expect(statements[0]?.text).toContain('pg_advisory_xact_lock(');
    expect(statements[0]?.values).toContain(budgetAdmissionQueueKey('org-1'));
    expect(statements[1]?.text).toContain(FOLD);
    expect(statements[1]?.values).toContain('org-1');
  });
});

describe('foldPendingBudgetUsage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('folds each organization with journal rows, skips one whose lock is held, and goes on past one that fails', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken = new Error('connection reset');
    const { sql, statements, transactions } = scriptedPool((text, values) => {
      if (text.includes('SELECT DISTINCT org_id')) {
        return [{ orgId: 'org-1' }, { orgId: 'org-2' }, { orgId: 'org-3' }];
      }
      const key = values.find(
        (value) =>
          typeof value === 'string' && value.startsWith('budget-admission:'),
      );
      if (text.includes('pg_try_advisory_xact_lock')) {
        return [{ locked: key !== budgetAdmissionQueueKey('org-2') }];
      }
      if (text.includes(FOLD)) {
        return values.includes('org-3')
          ? broken
          : [{ deltas: 5, emptiedPeriods: [] }];
      }
      return [];
    });

    await expect(foldPendingBudgetUsage(sql)).resolves.toEqual({
      folded: 5,
      skipped: 1,
      failed: 1,
    });

    expect(transactions()).toBe(3);
    const folds = statements.filter((statement) =>
      statement.text.includes(FOLD),
    );
    // The organization whose lock was held is folded by its holder.
    expect(folds.map((statement) => statement.values[0])).toEqual([
      'org-1',
      'org-3',
    ]);
    // A lock taken without waiting: an admission never queues behind it.
    expect(
      statements.some((statement) =>
        statement.text.includes('pg_advisory_xact_lock('),
      ),
    ).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('org-3'), broken);
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('5 journal row(s) folded'),
    );
  });

  it('reads the journal and nothing else when it is empty', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { sql, statements, transactions } = scriptedPool(() => []);

    await expect(foldPendingBudgetUsage(sql)).resolves.toEqual({
      folded: 0,
      skipped: 0,
      failed: 0,
    });

    expect(statements).toHaveLength(1);
    expect(transactions()).toBe(0);
    expect(info).not.toHaveBeenCalled();
  });
});
