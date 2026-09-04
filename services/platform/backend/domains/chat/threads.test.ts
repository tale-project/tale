// @vitest-environment node

/**
 * The sharing rules a conversation's lifecycle must honour: a share link
 * serves nothing for a thread in the trash, revoking the link works there
 * too, and refiling a project-shared thread never carries its audience into
 * the new project. The real-Postgres probes ride `integration-check.ts`;
 * these lock the statements the rules live in.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createAuditLog, findOrganizationMember, getUserTeamIds } = vi.hoisted(
  () => ({
    createAuditLog: vi.fn(),
    findOrganizationMember: vi.fn(),
    getUserTeamIds: vi.fn(),
  }),
);

vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));
vi.mock('../../auth/membership.ts', () => ({
  findOrganizationMember,
  getUserTeamIds,
}));

import {
  getSharedThread,
  moveThreadToProject,
  unshareThread,
} from './threads.ts';

interface Statement {
  text: string;
  values: unknown[];
}

const OWNED_ROW = {
  id: 'thread_1',
  organizationId: 'org_1',
  userId: 'user_1',
  title: 'Launch plan',
  kind: 'chat',
  agentSlug: null,
  harness: null,
  capabilities: null,
  reasoningEffort: null,
  projectId: 'project_a',
  sharedWithProject: true,
  archived: false,
  pinnedAt: null,
  lastReplyAt: null,
  lastReadAt: null,
  isShared: true,
  shareToken: 'tok',
  sharedAt: 1_000,
  sharedBy: 'user_1',
  status: 'active',
  branchRootId: null,
  hidden: null,
  createdAt: 1,
  updatedAt: 1,
};

/** A fake `sql` answering by statement shape; `answer` overrides per test.
 * Pool and transaction statements land in one ledger, in order. */
function fakeSql(answer: (statement: Statement) => unknown[] | undefined): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const statement = { text: strings.join('?'), values };
    statements.push(statement);
    return Promise.resolve(answer(statement) ?? []);
  };
  tag.unsafe = (text: string) => text;
  tag.json = (value: unknown) => ({ json: value });
  tag.begin = (fn: (tx: unknown) => Promise<unknown>) => fn(tag);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the thread functions exercise exactly the tag, unsafe, json, and begin surfaces faked here
  return { sql: tag as unknown as Sql, statements };
}

beforeEach(() => {
  vi.clearAllMocks();
  findOrganizationMember.mockResolvedValue({ role: 'owner' });
  getUserTeamIds.mockResolvedValue([]);
});

describe('getSharedThread', () => {
  it('resolves the token only for an ACTIVE thread — trash and expiry go dark', async () => {
    const { sql, statements } = fakeSql((statement) =>
      statement.text.includes('share_token') ? [OWNED_ROW] : [],
    );
    const view = await getSharedThread(sql, ['org_1'], 'tok');

    expect(view?.threadId).toBe('thread_1');
    const lookup = statements.find((s) => s.text.includes('share_token'));
    expect(lookup?.text).toContain("tm.status = 'active'");
  });

  it('maps NULL blocked_reason/error to ABSENT — a shared message is not a blocked, failed reply', async () => {
    const messageRow = {
      id: 'm1',
      role: 'user',
      parts: [{ type: 'text', text: 'hello' }],
      order: 0,
      stepOrder: 0,
      model: null,
      providerSlug: null,
      blockedReason: null,
      error: null,
      createdAt: 10,
    };
    const { sql } = fakeSql((statement) => {
      if (statement.text.includes('share_token')) return [OWNED_ROW];
      if (statement.text.includes('FROM app.messages')) {
        return [
          messageRow,
          {
            ...messageRow,
            id: 'm2',
            role: 'assistant',
            order: 1,
            blockedReason: 'content_policy',
            error: 'upstream refused',
            createdAt: 20,
          },
        ];
      }
      return undefined;
    });
    const view = await getSharedThread(sql, ['org_1'], 'tok');

    expect(view?.messages).toHaveLength(2);
    // The client tests `!== undefined`, so a SQL null must not survive into
    // the view — on the wire the two keys are simply absent.
    const [plain, blocked] = view?.messages ?? [];
    expect(plain?.blockedReason).toBeUndefined();
    expect(plain?.error).toBeUndefined();
    expect(JSON.parse(JSON.stringify(plain))).not.toHaveProperty(
      'blockedReason',
    );
    expect(JSON.parse(JSON.stringify(plain))).not.toHaveProperty('error');
    // A genuinely blocked or failed row keeps its stamps.
    expect(blocked?.blockedReason).toBe('content_policy');
    expect(blocked?.error).toBe('upstream refused');
  });
});

describe('unshareThread', () => {
  it('revokes on the owner-matched row regardless of lifecycle, and says whether it did', async () => {
    const { sql, statements } = fakeSql((statement) =>
      statement.text.includes('is_shared = false')
        ? [{ threadId: 'thread_1' }]
        : [],
    );
    await expect(
      unshareThread(sql, 'org_1', 'user_1', 'thread_1'),
    ).resolves.toBe(true);

    // One statement — no active-thread read in front of the write, so a
    // trashed thread's link is still revocable.
    expect(statements).toHaveLength(1);
    const revoke = statements[0];
    expect(revoke?.text).toContain('is_shared = false');
    expect(revoke?.text).not.toContain('status');
    expect(revoke?.values).toEqual(['thread_1', 'org_1', 'user_1']);
  });

  it('answers false for a thread the caller does not own', async () => {
    const { sql } = fakeSql(() => []);
    await expect(
      unshareThread(sql, 'org_1', 'user_2', 'thread_1'),
    ).resolves.toBe(false);
  });
});

describe('moveThreadToProject', () => {
  const auth = { organizationId: 'org_1', userId: 'user_1', email: 'o@x.io' };
  const answering =
    (row: typeof OWNED_ROW) =>
    (statement: Statement): unknown[] | undefined => {
      if (statement.text.includes('FROM app.threads t')) return [row];
      if (statement.text.includes('FROM app.projects WHERE id')) {
        return statement.text.includes('shared_with_team_ids')
          ? [{ orgId: 'org_1', teamId: null, sharedWithTeamIds: [] }]
          : [{ name: 'Project A' }];
      }
      return [];
    };

  it('ends the project share when the thread changes project, and audits the old project', async () => {
    const { sql, statements } = fakeSql(answering(OWNED_ROW));
    await expect(
      moveThreadToProject(sql, auth, 'thread_1', 'project_b'),
    ).resolves.toBe(true);

    const update = statements.find((s) =>
      s.text.includes('UPDATE app.thread_metadata'),
    );
    expect(update?.text).toContain('shared_with_project = ?');
    expect(update?.values).toEqual(['project_b', false, 'thread_1']);
    expect(createAuditLog).toHaveBeenCalledTimes(1);
    expect(createAuditLog.mock.calls[0]?.[1]).toMatchObject({
      action: 'project.thread.unshared',
      resourceType: 'project',
      resourceId: 'project_a',
      resourceName: 'Project A',
      actorId: 'user_1',
      actorEmail: 'o@x.io',
      previousState: { threadId: 'thread_1', shared: true },
      newState: {
        threadId: 'thread_1',
        shared: false,
        movedToProjectId: 'project_b',
      },
    });
  });

  it('ends the share when the thread is taken out of its project', async () => {
    const { sql, statements } = fakeSql(answering(OWNED_ROW));
    await moveThreadToProject(sql, auth, 'thread_1', null);

    const update = statements.find((s) =>
      s.text.includes('UPDATE app.thread_metadata'),
    );
    expect(update?.values).toEqual([null, false, 'thread_1']);
    expect(createAuditLog).toHaveBeenCalledTimes(1);
  });

  it('keeps the share when the project does not change, and audits nothing', async () => {
    const { sql, statements } = fakeSql(answering(OWNED_ROW));
    await moveThreadToProject(sql, auth, 'thread_1', 'project_a');

    const update = statements.find((s) =>
      s.text.includes('UPDATE app.thread_metadata'),
    );
    expect(update?.values).toEqual(['project_a', true, 'thread_1']);
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('audits nothing for a thread that was never shared', async () => {
    const { sql } = fakeSql(
      answering({ ...OWNED_ROW, sharedWithProject: false }),
    );
    await moveThreadToProject(sql, auth, 'thread_1', 'project_b');
    expect(createAuditLog).not.toHaveBeenCalled();
  });
});
