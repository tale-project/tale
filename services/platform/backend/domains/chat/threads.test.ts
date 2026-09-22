// @vitest-environment node

/**
 * The sharing rules a conversation's lifecycle must honour: a share link
 * serves nothing for a thread in the trash, revoking the link works there
 * too, and refiling a project-shared thread never carries its audience into
 * the new project, and every refiling leaves an audit row on the project the
 * chat lands in. The real-Postgres probes ride `integration-check.ts`;
 * these lock the statements the rules live in.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createAuditLog,
  findOrganizationMember,
  getUserTeamIds,
  assertNotHeld,
} = vi.hoisted(() => ({
  createAuditLog: vi.fn(),
  findOrganizationMember: vi.fn(),
  getUserTeamIds: vi.fn(),
  assertNotHeld: vi.fn(),
}));

vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));
vi.mock('../legal_holds/service.ts', async (original) => ({
  ...(await original<typeof import('../legal_holds/service.ts')>()),
  assertNotHeld,
}));
vi.mock('../../auth/membership.ts', () => ({
  findOrganizationMember,
  getUserTeamIds,
}));

import {
  getSharedThread,
  moveThreadToProject,
  searchChats,
  setThreadArchived,
  unshareThread,
  trashThread,
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
  const tag = (
    strings: TemplateStringsArray | readonly unknown[],
    ...values: unknown[]
  ) => {
    // `sql([...])` builds an `IN (...)` fragment; keep the list as a value.
    if (!('raw' in strings)) return { list: strings };
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
  assertNotHeld.mockResolvedValue(undefined);
});

describe('setThreadArchived legal hold', () => {
  it('checks the same organization, thread and custodian hold as Trash before writing', async () => {
    const { sql, statements } = fakeSql(() => [OWNED_ROW]);
    const refused = new Error('LEGAL_HOLD_ACTIVE');
    assertNotHeld.mockRejectedValueOnce(refused);
    await expect(
      setThreadArchived(
        sql,
        { organizationId: 'org_1', userId: 'user_1' },
        'thread_1',
        true,
      ),
    ).rejects.toThrow(refused);
    expect(assertNotHeld).toHaveBeenCalledWith(
      sql,
      'org_1',
      'thread',
      'thread_1',
      undefined,
      'user_1',
    );
    expect(statements.some(({ text }) => text.includes('UPDATE'))).toBe(false);
    expect(createAuditLog).not.toHaveBeenCalled();
  });
});

/**
 * The REST door's fence is the archive UPDATE's own predicate, on the
 * columns the send's claim and the worker's open write in their
 * transactions — the row lock serialises them, so a send that commits
 * between a door's read and its write is seen (2026-09-19 evaluation,
 * K2-1). The domain re-reads after a held-back write to tell a claimed row
 * from a thread that moved meanwhile.
 */
describe('setThreadArchived with the turn fence', () => {
  const auth = { organizationId: 'org_1', userId: 'user_1' };
  const predicate = (text: string): boolean =>
    text.includes('generation_queued_since_ms IS NULL') &&
    text.includes("generation_status IS DISTINCT FROM 'generating'") &&
    text.includes("status = 'active' AND archived = false") &&
    text.includes('RETURNING');

  it('archives through one conditional UPDATE and audits it', async () => {
    const { sql, statements } = fakeSql(({ text }) =>
      text.includes('UPDATE app.thread_metadata SET archived')
        ? [{ threadId: 'thread_1' }]
        : [OWNED_ROW],
    );
    await expect(
      setThreadArchived(sql, auth, 'thread_1', true, {
        refuseWhenTurnPending: true,
      }),
    ).resolves.toMatchObject({ archived: true });
    const update = statements.find(({ text }) =>
      text.includes('UPDATE app.thread_metadata SET archived'),
    );
    expect(update).toBeDefined();
    expect(predicate(update?.text ?? '')).toBe(true);
    expect(createAuditLog).toHaveBeenCalledTimes(1);
  });

  it('answers CHAT_TURN_IN_PROGRESS when a turn claimed the row meanwhile, writing no audit', async () => {
    const { sql } = fakeSql(({ text }) => {
      if (text.includes('UPDATE app.thread_metadata SET archived')) return [];
      if (text.includes('SELECT status, archived FROM app.thread_metadata')) {
        return [{ status: 'active', archived: false }];
      }
      return [OWNED_ROW];
    });
    await expect(
      setThreadArchived(sql, auth, 'thread_1', true, {
        refuseWhenTurnPending: true,
      }),
    ).rejects.toMatchObject({ code: 'CHAT_TURN_IN_PROGRESS', status: 409 });
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('answers the state another writer left when the thread was archived or trashed meanwhile', async () => {
    const archivedMeanwhile = fakeSql(({ text }) => {
      if (text.includes('UPDATE app.thread_metadata SET archived')) return [];
      if (text.includes('SELECT status, archived FROM app.thread_metadata')) {
        return [{ status: 'active', archived: true }];
      }
      return [{ ...OWNED_ROW, archivedAt: 5_000 }];
    });
    await expect(
      setThreadArchived(archivedMeanwhile.sql, auth, 'thread_1', true, {
        refuseWhenTurnPending: true,
      }),
    ).resolves.toEqual({ archived: true, archivedAt: 5_000 });
    const trashedMeanwhile = fakeSql(({ text }) => {
      if (text.includes('UPDATE app.thread_metadata SET archived')) return [];
      if (text.includes('SELECT status, archived FROM app.thread_metadata')) {
        return [{ status: 'trashed', archived: false }];
      }
      return [OWNED_ROW];
    });
    await expect(
      setThreadArchived(trashedMeanwhile.sql, auth, 'thread_1', true, {
        refuseWhenTurnPending: true,
      }),
    ).resolves.toBeNull();
  });

  it('writes unfenced without the option — the app’s own archive', async () => {
    const { sql, statements } = fakeSql(({ text }) =>
      text.includes('UPDATE app.thread_metadata SET archived')
        ? [{ threadId: 'thread_1' }]
        : [OWNED_ROW],
    );
    await setThreadArchived(sql, auth, 'thread_1', true);
    const update = statements.find(({ text }) =>
      text.includes('UPDATE app.thread_metadata SET archived'),
    );
    expect(predicate(update?.text ?? '')).toBe(false);
  });
});

describe('trashThread with the turn fence', () => {
  const auth = { organizationId: 'org_1', userId: 'user_1' };

  it('trashes through one conditional UPDATE — no separate generation read', async () => {
    const { sql, statements } = fakeSql(({ text }) =>
      text.includes("status = 'trashed', status_changed_at_ms") &&
      text.includes('RETURNING')
        ? [{ threadId: 'thread_1' }]
        : [OWNED_ROW],
    );
    await expect(trashThread(sql, auth, 'thread_1')).resolves.toBe(true);
    const update = statements.find(
      ({ text }) =>
        text.includes("status = 'trashed', status_changed_at_ms") &&
        text.includes('RETURNING'),
    );
    expect(update?.text).toContain('generation_queued_since_ms IS NULL');
    expect(update?.text).toContain(
      "generation_status IS DISTINCT FROM 'generating'",
    );
    expect(
      statements.some(({ text }) =>
        text.startsWith(
          '\n    SELECT thread_id AS "threadId" FROM app.generations',
        ),
      ),
    ).toBe(false);
    expect(createAuditLog).toHaveBeenCalledTimes(1);
  });

  it('answers CHAT_TURN_IN_PROGRESS when a send claimed the row meanwhile, and true when it was trashed meanwhile', async () => {
    const claimed = fakeSql(({ text }) => {
      if (text.includes("status = 'trashed', status_changed_at_ms")) return [];
      if (text.includes('SELECT status FROM app.thread_metadata')) {
        return [{ status: 'active' }];
      }
      return [OWNED_ROW];
    });
    await expect(
      trashThread(claimed.sql, auth, 'thread_1'),
    ).rejects.toMatchObject({
      code: 'CHAT_TURN_IN_PROGRESS',
      status: 409,
    });
    expect(createAuditLog).not.toHaveBeenCalled();
    const trashedMeanwhile = fakeSql(({ text }) => {
      if (text.includes("status = 'trashed', status_changed_at_ms")) return [];
      if (text.includes('SELECT status FROM app.thread_metadata')) {
        return [{ status: 'trashed' }];
      }
      return [OWNED_ROW];
    });
    await expect(
      trashThread(trashedMeanwhile.sql, auth, 'thread_1'),
    ).resolves.toBe(true);
  });
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
    (row: Omit<typeof OWNED_ROW, 'projectId'> & { projectId: string | null }) =>
    (statement: Statement): unknown[] | undefined => {
      if (statement.text.includes('FROM app.threads t')) return [row];
      if (statement.text.includes('FROM app.projects WHERE id')) {
        // The access read selects the audience (`PROJECT_TEAM_IDS_SQL`,
        // bound as a value by the stand-in's `unsafe`); the other read is
        // the project's name.
        return statement.text.includes('AS "teamIds"')
          ? [{ orgId: 'org_1', teamIds: [] }]
          : [{ name: 'Project A' }];
      }
      return [];
    };

  it('ends the project share when the thread changes project: audits the unshare on the old project and the move on the new one', async () => {
    const { sql, statements } = fakeSql(answering(OWNED_ROW));
    await expect(
      moveThreadToProject(sql, auth, 'thread_1', 'project_b'),
    ).resolves.toBe(true);

    const update = statements.find((s) =>
      s.text.includes('UPDATE app.thread_metadata'),
    );
    expect(update?.text).toContain('shared_with_project = ?');
    expect(update?.values).toEqual(['project_b', false, 'thread_1']);
    expect(createAuditLog).toHaveBeenCalledTimes(2);
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
    expect(createAuditLog.mock.calls[1]?.[1]).toMatchObject({
      action: 'project.thread.moved',
      resourceType: 'project',
      resourceId: 'project_b',
      actorId: 'user_1',
      previousState: { threadId: 'thread_1', projectId: 'project_a' },
      newState: { threadId: 'thread_1', projectId: 'project_b' },
    });
  });

  it('ends the share when the thread is taken out of its project, anchoring the move on the project it leaves', async () => {
    const { sql, statements } = fakeSql(answering(OWNED_ROW));
    await moveThreadToProject(sql, auth, 'thread_1', null);

    const update = statements.find((s) =>
      s.text.includes('UPDATE app.thread_metadata'),
    );
    expect(update?.values).toEqual([null, false, 'thread_1']);
    expect(createAuditLog).toHaveBeenCalledTimes(2);
    expect(createAuditLog.mock.calls[0]?.[1]).toMatchObject({
      action: 'project.thread.unshared',
      resourceId: 'project_a',
    });
    expect(createAuditLog.mock.calls[1]?.[1]).toMatchObject({
      action: 'project.thread.moved',
      resourceId: 'project_a',
      previousState: { threadId: 'thread_1', projectId: 'project_a' },
      newState: { threadId: 'thread_1', projectId: null },
    });
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

  it('audits a plain move of a thread that was never shared — no unshare row', async () => {
    const { sql } = fakeSql(
      answering({ ...OWNED_ROW, sharedWithProject: false }),
    );
    await moveThreadToProject(sql, auth, 'thread_1', 'project_b');
    expect(createAuditLog).toHaveBeenCalledTimes(1);
    expect(createAuditLog.mock.calls[0]?.[1]).toMatchObject({
      action: 'project.thread.moved',
      resourceId: 'project_b',
      previousState: { threadId: 'thread_1', projectId: 'project_a' },
      newState: { threadId: 'thread_1', projectId: 'project_b' },
    });
  });

  it('audits filing an unfiled thread into a project, on that project', async () => {
    const { sql } = fakeSql(
      answering({ ...OWNED_ROW, projectId: null, sharedWithProject: false }),
    );
    await moveThreadToProject(sql, auth, 'thread_1', 'project_b');
    expect(createAuditLog).toHaveBeenCalledTimes(1);
    expect(createAuditLog.mock.calls[0]?.[1]).toMatchObject({
      action: 'project.thread.moved',
      resourceId: 'project_b',
      previousState: { threadId: 'thread_1', projectId: null },
      newState: { threadId: 'thread_1', projectId: 'project_b' },
    });
  });
});

/**
 * The palette search reads the transcript the user reads: an edit or
 * regenerate lands on a HIDDEN sibling that never graduates, so the message
 * window is ranked per ROOT across every live thread of its lineage and a
 * hit is reported under the root. A settled Arena loser (archived) drops
 * out through the same predicate.
 */
describe('searchChats lineage', () => {
  const ROOT = { id: 'thread_1', title: 'Launch plan', updatedAt: 5 };

  it('joins the metadata and scopes the message window by branch root, live threads only', async () => {
    const { sql, statements } = fakeSql(({ text }) => {
      if (text.includes('FROM app.threads t')) return [ROOT];
      if (text.includes('FROM app.messages m')) {
        return [
          { threadId: 'thread_1', text: 'edited on the branch', rank: 1 },
        ];
      }
      return [];
    });
    const hits = await searchChats(sql, 'org_1', 'user_1', 'edited branch');
    expect(hits).toEqual([
      {
        threadId: 'thread_1',
        title: 'Launch plan',
        snippet: 'edited on the branch',
        updatedAt: 5,
      },
    ]);
    const roots = statements.find(({ text }) =>
      text.includes('FROM app.threads t'),
    );
    expect(roots?.text).toContain('tm.hidden IS NOT true');
    const messages = statements.find(({ text }) =>
      text.includes('FROM app.messages m'),
    );
    expect(messages).toBeDefined();
    const read = messages?.text ?? '';
    expect(read).toContain(
      'JOIN app.thread_metadata tm ON tm.thread_id = m.thread_id',
    );
    expect(read).toContain(
      'PARTITION BY coalesce(tm.branch_root_id, m.thread_id)',
    );
    // Root rows carry a NULL branch_root_id; siblings name the root — both
    // halves of the predicate keep their index.
    expect(read).toContain('WHERE (tm.branch_root_id IN ?');
    expect(read).toContain(
      'OR (tm.branch_root_id IS NULL AND m.thread_id IN ?',
    );
    expect(read).toContain("tm.status = 'active' AND tm.archived = false");
    expect(read).not.toContain('tm.hidden');
    // The scan list feeds the IN (...) of the lineage predicate.
    expect(messages?.values).toContainEqual({ list: ['thread_1'] });
  });

  it('reads no messages when the caller has no live root', async () => {
    const { sql, statements } = fakeSql(() => []);
    await expect(
      searchChats(sql, 'org_1', 'user_1', 'anything'),
    ).resolves.toEqual([]);
    expect(
      statements.some(({ text }) => text.includes('FROM app.messages m')),
    ).toBe(false);
  });
});
