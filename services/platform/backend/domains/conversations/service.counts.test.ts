/**
 * The Inbox count tiles must show what the viewer can actually open.
 *
 * The list door filters row by row with `conversationAssignmentAllows` — the
 * ONE definition of inbox visibility. A count cannot stream every row to do
 * that, so both count doors carry a SQL mirror of the same predicate. A mirror
 * is a second copy, and a second copy is exactly what
 * `backend/core/lib/rls/helpers/conversation_assignment.ts` warns about: the
 * failure mode it names is publishing an entire inbox.
 *
 * So these tests pin the mirror rather than trust it. They assert the two
 * queries carry the SAME predicate, that it binds what the rule needs, and
 * that an unassigned row is admin-triage only — the branch a widening edit
 * would break first.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getUserTeamIds } = vi.hoisted(() => ({
  getUserTeamIds: vi.fn(async () => ['t-support']),
}));

vi.mock('../../auth/membership.ts', () => ({
  getUserTeamIds,
  findOrganizationMember: vi.fn(async () => null),
}));
vi.mock('../files/service.ts', () => ({
  getFileUrl: vi.fn(async () => ''),
  statOrgBlob: vi.fn(async () => ({ size: 0 })),
}));
vi.mock('../../realtime/outbox.ts', () => ({
  emitHintInTx: vi.fn(async () => undefined),
}));

import {
  countConversationsByStatus,
  countUnreadConversations,
} from './service.ts';

/** A `sql` stand-in that records every statement it is handed. */
function recordingSql(rows: unknown[] = []) {
  const statements: { text: string; values: unknown[] }[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    statements.push({
      text: strings.join('?').replace(/\s+/g, ' ').trim(),
      values,
    });
    return Promise.resolve(rows);
  };
  const sql = Object.assign(tag, {
    unsafe: (text: string) => text,
    json: (value: unknown) => value,
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return { sql: sql as unknown as Sql, statements };
}

const ORG = 'o1';
const ADMIN = { organizationId: ORG, userId: 'u-admin', role: 'admin' };
const MEMBER = { organizationId: ORG, userId: 'u-member', role: 'member' };

/** The assignment predicate as the count queries emit it, values replaced. */
const PREDICATE =
  'AND ( ? OR assignee_user_id = ? OR assignee_team_id = ANY(?) )';

/** The counting statement, not the team lookup that precedes it. */
function countStatement(statements: { text: string; values: unknown[] }[]) {
  const found = statements.find((s) =>
    s.text.includes('FROM app.conversations'),
  );
  if (!found) throw new Error('no count statement was issued');
  return found;
}

beforeEach(() => {
  getUserTeamIds.mockClear();
});

describe('count tiles scope to what the viewer may open', () => {
  it('both count doors emit the same assignment predicate', async () => {
    const byStatus = recordingSql([]);
    await countConversationsByStatus(byStatus.sql, MEMBER);
    const unread = recordingSql([{ count: '0' }]);
    await countUnreadConversations(unread.sql, MEMBER);

    expect(countStatement(byStatus.statements).text).toContain(PREDICATE);
    expect(countStatement(unread.statements).text).toContain(PREDICATE);
  });

  it('binds the rule’s three branches for a member', async () => {
    const { sql, statements } = recordingSql([]);
    await countConversationsByStatus(sql, MEMBER);

    const { values } = countStatement(statements);
    expect(values).toContain(false); // not an admin
    expect(values).toContain(MEMBER.userId); // own assignments
    expect(values).toContainEqual(['t-support']); // their team's
  });

  it('short-circuits to true for an admin and skips the team lookup', async () => {
    const { sql, statements } = recordingSql([]);
    await countConversationsByStatus(sql, ADMIN);

    const { values } = countStatement(statements);
    expect(values).toContain(true);
    expect(values).toContainEqual([]);
    // The rule decides an admin before teams matter; paying for the
    // round-trip anyway is the regression `lazy_teams` guards elsewhere.
    expect(getUserTeamIds).not.toHaveBeenCalled();
  });

  it('counts no unassigned row for a member — triage is admin-only', async () => {
    const { sql, statements } = recordingSql([]);
    await countConversationsByStatus(sql, MEMBER);

    const { text } = countStatement(statements);
    // Both stamps NULL must satisfy NO branch: `NULL = <id>` is NULL, so the
    // row is not counted. Any clause that admits a null assignee here makes
    // the tiles wider than the list and publishes the triage queue.
    expect(text).not.toMatch(/assignee_user_id IS NULL/i);
    expect(text).not.toMatch(/assignee_team_id IS NULL/i);
    expect(text).not.toMatch(/coalesce\(assignee/i);
  });
});
