/**
 * The holds of the work in flight, and the admission lock. The SQL runs on a
 * scripted `sql` here — what the holds add up to on a real schema, and that
 * racing admissions cannot both pass a cap, is the integration check's.
 */

import {
  isSerializationFailure,
  retryQueueKeysOf,
} from '@tale/shared/db/serializable';
import { describe, expect, it } from 'vitest';

import {
  budgetAdmissionQueueKey,
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
    expect(read).toContain('JOIN "teamMember" tm ON tm."userId" = h.user_id');
    expect(statements[0]?.values).toEqual(
      expect.arrayContaining(['org-1', 'user-1', 'key-1', ['team-1']]),
    );
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
      },
    );
    expect(statements[0]?.text).toContain('thread_id <> ?');
    expect(statements[0]?.text).toContain(
      'AND NOT (session_id = ? AND exec_id = ?)',
    );
    expect(statements[0]?.values).toEqual(
      expect.arrayContaining(['thread-1', 'session-1', 'exec-1']),
    );
  });
});

describe('lockBudgetAdmission', () => {
  it('takes the queue lock, then bumps the organization’s admission row', async () => {
    const { sql, statements } = scriptedSql([]);
    await lockBudgetAdmission(sql, 'org-1');

    expect(statements).toHaveLength(2);
    expect(statements[0]?.text).toContain('pg_advisory_xact_lock');
    expect(statements[0]?.values).toContain(budgetAdmissionQueueKey('org-1'));
    expect(statements[1]?.text).toContain('INSERT INTO app.budget_admissions');
    // The bump is what a stale SERIALIZABLE snapshot conflicts with.
    expect(statements[1]?.text).toContain(
      'ON CONFLICT (org_id) DO UPDATE SET admitted_at_ms',
    );
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
