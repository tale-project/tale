/**
 * You cannot assign a conversation to someone who cannot see it. The admin
 * assign door shares the one assignee gate with address routing and compose:
 * the assignee must hold an ACTIVE membership of the org, or the write is
 * refused — a non-member "assignee" hid the row from every non-admin while
 * nobody could ever open it.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audit_logs/service.ts', () => ({
  createAuditLog: vi.fn(async () => undefined),
}));
vi.mock('../collab/service.ts', () => ({
  notifyConversationAssigned: vi.fn(async () => undefined),
  notifyConversationAssignedTeam: vi.fn(async () => undefined),
}));
vi.mock('../../realtime/outbox.ts', () => ({
  emitHintInTx: vi.fn(async () => undefined),
}));

import {
  assertAssignableMember,
  assignConversation,
  ConversationError,
} from './service.ts';

const ORG = 'org_1';
const CONVERSATION = {
  id: 'conv_1',
  organizationId: ORG,
  assigneeUserId: null,
  assigneeTeamId: null,
  subject: 'Order 42',
  status: 'open',
};

/**
 * A `sql` stand-in scripted per query, in call order, that records every
 * statement it ran; `begin` hands the same double out as the transaction.
 */
function scriptedSql(script: unknown[][]): { sql: Sql; queries: string[] } {
  const queries: string[] = [];
  let index = 0;
  const tag = (strings: TemplateStringsArray): Promise<unknown[]> => {
    queries.push(strings.join('?').replace(/\s+/g, ' ').trim());
    const rows = script[index] ?? [];
    index += 1;
    return Promise.resolve(rows);
  };
  const double = Object.assign(tag, {
    unsafe: (text: string) => text,
    json: (value: unknown) => value,
    begin: (fn: (tx: unknown) => Promise<unknown>) => fn(double),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return { sql: double as unknown as Sql, queries };
}

const admin = { userId: 'user_admin', email: 'admin@door.test', role: 'admin' };

describe('assertAssignableMember', () => {
  it('refuses a user with no member row in the org', async () => {
    const { sql } = scriptedSql([[]]);
    await expect(
      assertAssignableMember(sql, ORG, 'user_stranger'),
    ).rejects.toMatchObject({
      code: 'user_not_in_org',
      status: 400,
    } satisfies Partial<ConversationError>);
  });

  it('refuses a disabled seat — the row would be visible to nobody', async () => {
    const { sql } = scriptedSql([
      [{ id: 'm1', organizationId: ORG, userId: 'user_off', role: 'disabled' }],
    ]);
    await expect(
      assertAssignableMember(sql, ORG, 'user_off'),
    ).rejects.toMatchObject({ code: 'user_not_in_org' });
  });

  it('admits an active member', async () => {
    const { sql } = scriptedSql([
      [{ id: 'm1', organizationId: ORG, userId: 'user_m', role: 'member' }],
    ]);
    await expect(
      assertAssignableMember(sql, ORG, 'user_m'),
    ).resolves.toBeUndefined();
  });
});

describe('assignConversation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses a non-member assignee before writing anything', async () => {
    const { sql, queries } = scriptedSql([
      [CONVERSATION], // the conversation row
      [], // no member row for the stranger
    ]);
    await expect(
      assignConversation(sql, {
        organizationId: ORG,
        conversationId: 'conv_1',
        assigneeUserId: 'user_stranger',
        actor: admin,
      }),
    ).rejects.toMatchObject({ code: 'user_not_in_org', status: 400 });
    expect(queries.some((query) => query.startsWith('UPDATE'))).toBe(false);
  });

  it('writes the assignment for an active member of the org', async () => {
    const { sql, queries } = scriptedSql([
      [CONVERSATION],
      [{ id: 'm1', organizationId: ORG, userId: 'user_m', role: 'member' }],
      [], // the UPDATE
    ]);
    await assignConversation(sql, {
      organizationId: ORG,
      conversationId: 'conv_1',
      assigneeUserId: 'user_m',
      actor: admin,
    });
    expect(queries[1]).toContain('FROM "member"');
    expect(queries[2]).toContain(
      'UPDATE app.conversations SET assignee_user_id',
    );
  });

  it('unassigning consults no membership — null is always allowed', async () => {
    const { sql, queries } = scriptedSql([
      [{ ...CONVERSATION, assigneeUserId: 'user_m' }],
      [], // the UPDATE
    ]);
    await assignConversation(sql, {
      organizationId: ORG,
      conversationId: 'conv_1',
      assigneeUserId: null,
      actor: admin,
    });
    expect(queries.some((query) => query.includes('FROM "member"'))).toBe(
      false,
    );
    expect(queries[1]).toContain(
      'UPDATE app.conversations SET assignee_user_id',
    );
  });

  it('stays admin-only', async () => {
    const { sql, queries } = scriptedSql([]);
    await expect(
      assignConversation(sql, {
        organizationId: ORG,
        conversationId: 'conv_1',
        assigneeUserId: 'user_m',
        actor: { userId: 'user_member', role: 'member' },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(queries).toHaveLength(0);
  });
});
