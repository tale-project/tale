/**
 * Every Inbox door must answer for the same conversations — the list, the
 * status tiles, and the unread tile.
 *
 * The single-row doors apply `conversationAssignmentAllows` — the ONE
 * definition of inbox visibility. Neither a count nor a keyset page can stream
 * every row through that rule, so they share a SQL mirror of it. A mirror is a
 * second copy, and a second copy is exactly what
 * `backend/core/lib/rls/helpers/conversation_assignment.ts` warns about: the
 * failure mode it names is publishing an entire inbox.
 *
 * So these tests pin the mirror rather than trust it. They assert the three
 * queries carry the SAME predicate, that it binds what the rule needs, that an
 * unassigned row is admin-triage only — the branch a widening edit would break
 * first — and that the list applies it in the statement that carries `LIMIT`,
 * which is what keeps a page from running short.
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
  listConversationsPage,
} from './service.ts';

const FRAGMENT = Symbol('fragment');
interface Fragment {
  [FRAGMENT]: true;
  text: string;
  values: unknown[];
}

function isFragment(value: unknown): value is Fragment {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [FRAGMENT]?: true })[FRAGMENT] === true
  );
}

/**
 * A `sql` stand-in that inlines nested `sql\`…\`` fragments the way
 * postgres.js does, so a recorded statement is the one Postgres would see —
 * the whole point here, since the predicate under test IS a fragment.
 */
function recordingSql(rows: unknown[] = []) {
  const statements: { text: string; values: unknown[] }[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = '';
    const flat: unknown[] = [];
    strings.forEach((part, index) => {
      text += part;
      if (index >= values.length) return;
      const value = values[index];
      if (isFragment(value)) {
        text += value.text;
        flat.push(...value.values);
      } else {
        text += '?';
        flat.push(value);
      }
    });
    text = text.replace(/\s+/g, ' ').trim();
    statements.push({ text, values: flat });
    const fragment: Fragment = { [FRAGMENT]: true, text, values: flat };
    return Object.assign(Promise.resolve(rows), fragment);
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

/** The assignment predicate as the three doors emit it, values replaced. */
const PREDICATE =
  'AND ( ? OR assignee_user_id = ? OR assignee_team_id = ANY(?) )';

/** The statement that reads conversations, not a fragment or a batch read. */
function conversationStatement(
  statements: { text: string; values: unknown[] }[],
) {
  const found = statements.find((s) =>
    s.text.includes('FROM app.conversations'),
  );
  if (!found) throw new Error('no conversations statement was issued');
  return found;
}

/** The list door's own page read, keyed on the paging it does. */
function listPage(sql: Sql, viewer: typeof MEMBER) {
  return listConversationsPage(sql, viewer, {
    status: 'archived',
    cursor: null,
    limit: 30,
  });
}

beforeEach(() => {
  getUserTeamIds.mockClear();
});

describe('every inbox door scopes to what the viewer may open', () => {
  it('the list and both count doors emit the same assignment predicate', async () => {
    const list = recordingSql([]);
    await listPage(list.sql, MEMBER);
    const byStatus = recordingSql([]);
    await countConversationsByStatus(byStatus.sql, MEMBER);
    const unread = recordingSql([{ count: '0' }]);
    await countUnreadConversations(unread.sql, MEMBER);

    expect(conversationStatement(list.statements).text).toContain(PREDICATE);
    expect(conversationStatement(byStatus.statements).text).toContain(
      PREDICATE,
    );
    expect(conversationStatement(unread.statements).text).toContain(PREDICATE);
  });

  it('the list scopes in the statement that pages, so a page cannot run short', async () => {
    const { sql, statements } = recordingSql([]);
    await listPage(sql, MEMBER);

    // One statement carries both the predicate and the LIMIT. Filtering after
    // the page instead lets rows the viewer cannot open consume its slots —
    // an inbox full of admin-triage rows then lists nothing under a tile that
    // counts two, because an empty page never asks for the next one.
    const { text } = conversationStatement(statements);
    expect(text).toContain(PREDICATE);
    expect(text).toMatch(/ORDER BY .* LIMIT \?$/);
  });

  it('binds the rule’s three branches for a member', async () => {
    const { sql, statements } = recordingSql([]);
    await countConversationsByStatus(sql, MEMBER);

    const { values } = conversationStatement(statements);
    expect(values).toContain(false); // not an admin
    expect(values).toContain(MEMBER.userId); // own assignments
    expect(values).toContainEqual(['t-support']); // their team's
  });

  it('short-circuits to true for an admin and skips the team lookup', async () => {
    const { sql, statements } = recordingSql([]);
    await countConversationsByStatus(sql, ADMIN);

    const { values } = conversationStatement(statements);
    expect(values).toContain(true);
    expect(values).toContainEqual([]);
    // The rule decides an admin before teams matter; paying for the
    // round-trip anyway is the regression `lazy_teams` guards elsewhere.
    expect(getUserTeamIds).not.toHaveBeenCalled();
  });

  it('shows no unassigned row to a member — triage is admin-only', async () => {
    const list = recordingSql([]);
    await listPage(list.sql, MEMBER);
    const counts = recordingSql([]);
    await countConversationsByStatus(counts.sql, MEMBER);

    for (const statements of [list.statements, counts.statements]) {
      const { text } = conversationStatement(statements);
      // Both stamps NULL must satisfy NO branch: `NULL = <id>` is NULL, so the
      // row is neither listed nor counted. Any clause that admits a null
      // assignee here publishes the triage queue.
      expect(text).not.toMatch(/assignee_user_id IS NULL/i);
      expect(text).not.toMatch(/assignee_team_id IS NULL/i);
      expect(text).not.toMatch(/coalesce\(assignee/i);
    }
  });
});
