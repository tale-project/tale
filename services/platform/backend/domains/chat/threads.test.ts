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
  branchForEdit,
  branchForRegenerate,
  getSharedThread,
  moveThreadToProject,
  searchChats,
  setThreadArchived,
  shareThread,
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
  branchParentId: null,
  branchForkSequence: null,
  sharedThreadId: null,
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

/**
 * A share names the ROOT but publishes the sibling on screen: the leaf is
 * frozen on the root row at share time, and the snapshot reads ITS rows.
 * A leaf outside the lineage (or someone else's) refuses the share.
 */
describe('shareThread freezes the leaf', () => {
  const isOwnedRead = (s: Statement) =>
    s.text.includes('FROM app.threads t') && s.text.includes('WHERE t.id = ?');
  const isSiblingCheck = (s: Statement) =>
    s.text.includes('tm.branch_root_id = ?') &&
    s.text.includes('t.user_id = ?');
  const update = (statements: Statement[]) =>
    statements.find((s) => s.text.includes('shared_thread_id = ?'));

  it('stores the sibling on screen when it is a live branch of the root, owned by the sharer', async () => {
    const { sql, statements } = fakeSql((statement) => {
      if (isSiblingCheck(statement)) return [{ id: 'b1' }];
      if (isOwnedRead(statement)) return [OWNED_ROW];
      return undefined;
    });
    await expect(
      shareThread(sql, 'org_1', 'user_1', 'thread_1', 'b1'),
    ).resolves.toEqual({ shareToken: 'tok' });
    const check = statements.find(isSiblingCheck);
    expect(check?.values).toEqual(['b1', 'org_1', 'user_1', 'thread_1']);
    expect(check?.text).toContain("tm.status = 'active'");
    // share_token, shared_at_ms, shared_by, shared_thread_id, thread_id
    expect(update(statements)?.values[3]).toBe('b1');
  });

  it('stores NULL for the root itself — no lineage read', async () => {
    const { sql, statements } = fakeSql((statement) =>
      isOwnedRead(statement) ? [OWNED_ROW] : undefined,
    );
    await shareThread(sql, 'org_1', 'user_1', 'thread_1', 'thread_1');
    expect(statements.some(isSiblingCheck)).toBe(false);
    expect(update(statements)?.values[3]).toBeNull();
  });

  it('refuses a leaf that is not a live sibling of the root (foreign, trashed, another lineage)', async () => {
    const { sql, statements } = fakeSql((statement) => {
      if (isSiblingCheck(statement)) return [];
      if (isOwnedRead(statement)) return [OWNED_ROW];
      return undefined;
    });
    await expect(
      shareThread(sql, 'org_1', 'user_1', 'thread_1', 'not-mine'),
    ).resolves.toBeNull();
    expect(update(statements)).toBeUndefined();
  });

  it('resolves the leaf from the stored selection map when the caller names none', async () => {
    const { sql, statements } = fakeSql((statement) => {
      if (statement.text.includes('branch_parent_id IS NOT NULL')) {
        return [
          { id: 'b1', parentId: 'thread_1', forkSequence: 2, createdAt: 5 },
          { id: 'b2', parentId: 'b1', forkSequence: 4, createdAt: 6 },
        ];
      }
      if (statement.text.includes('SELECT branch_selections')) {
        return [{ branchSelections: '{"thread_1:2":"b1","b1:4":"b2"}' }];
      }
      if (isOwnedRead(statement)) return [OWNED_ROW];
      return undefined;
    });
    await shareThread(sql, 'org_1', 'user_1', 'thread_1');
    expect(update(statements)?.values[3]).toBe('b2');
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

  it('reads the frozen sibling’s rows while it is live, the root’s once it is gone', async () => {
    const messagesOf = (statements: Statement[]) =>
      statements.find((s) => s.text.includes('FROM app.messages'));
    const isLeafCheck = (s: Statement) =>
      s.text.includes('tm.branch_root_id = ?') &&
      s.text.includes('tm.thread_id = ?');
    const frozen = { ...OWNED_ROW, sharedThreadId: 'b1' };

    const live = fakeSql((statement) => {
      if (statement.text.includes('share_token')) return [frozen];
      if (isLeafCheck(statement)) return [{ id: 'b1' }];
      return [];
    });
    const view = await getSharedThread(live.sql, ['org_1'], 'tok');
    // The link still names the root; only the rows come from the leaf.
    expect(view?.threadId).toBe('thread_1');
    expect(messagesOf(live.statements)?.values).toEqual(['b1', 1_000]);

    const gone = fakeSql((statement) =>
      statement.text.includes('share_token') ? [frozen] : [],
    );
    await getSharedThread(gone.sql, ['org_1'], 'tok');
    expect(messagesOf(gone.statements)?.values).toEqual(['thread_1', 1_000]);
  });

  it('reads the root when nothing was frozen — every share taken before the column', async () => {
    const { sql, statements } = fakeSql((statement) =>
      statement.text.includes('share_token') ? [OWNED_ROW] : [],
    );
    await getSharedThread(sql, ['org_1'], 'tok');
    expect(
      statements.some((s) => s.text.includes('tm.branch_root_id = ?')),
    ).toBe(false);
    expect(
      statements.find((s) => s.text.includes('FROM app.messages'))?.values[0],
    ).toBe('thread_1');
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

/**
 * A fork at or before a sibling's own fork sequence versions the SAME turn
 * as that sibling: it hangs off the sibling's parent (walking up through a
 * chain written before this rule), so "Try again" then "Edit" — or two
 * "Try again"s — read as three siblings of one fork point with the original
 * among them. A fork after the sibling's own fork stays on the sibling.
 */
describe('branchForEdit / branchForRegenerate hang a fork off the turn it versions', () => {
  interface Ancestor {
    id: string;
    branchParentId: string | null;
    branchForkSequence: number | null;
  }
  const isAncestorRead = (s: Statement) =>
    s.text.includes('tm.branch_parent_id AS "branchParentId"');
  const isOwnedRead = (s: Statement) =>
    s.text.includes('FROM app.threads t') && s.text.includes('WHERE t.id = ?');
  const drive = (
    onScreen: Record<string, unknown>,
    ancestors: Ancestor[],
    message: { order: number; role: string },
    prompt?: { order: number },
  ) =>
    fakeSql((statement) => {
      if (isAncestorRead(statement)) {
        return ancestors.filter((row) => row.id === statement.values[0]);
      }
      if (isOwnedRead(statement)) return [onScreen];
      if (statement.text.includes('SELECT "order", role FROM app.messages')) {
        return [message];
      }
      if (statement.text.includes("role = 'user'") && prompt) return [prompt];
      if (statement.text.includes('INSERT INTO app.threads')) {
        return [{ id: 'b_new' }];
      }
      return [];
    });
  /** root, parent, fork sequence — the lineage stamps of the new sibling. */
  const stamps = (statements: Statement[]) =>
    statements
      .find((s) => s.text.includes('INSERT INTO app.thread_metadata'))
      ?.values.slice(9, 12);
  const copiedFrom = (statements: Statement[]) =>
    statements.find((s) => s.text.includes('INSERT INTO app.messages'))?.values;
  const sibling = (id: string, parentId: string, forkSequence: number) => ({
    ...OWNED_ROW,
    id,
    branchRootId: 'thread_1',
    branchParentId: parentId,
    branchForkSequence: forkSequence,
    isShared: null,
    shareToken: null,
    sharedAt: null,
    sharedBy: null,
    hidden: true,
  });
  const root: Ancestor = {
    id: 'thread_1',
    branchParentId: null,
    branchForkSequence: null,
  };

  it('edit at the sequence a "try again" sibling forked at hangs off the sibling’s parent', async () => {
    const { sql, statements } = drive(sibling('b1', 'thread_1', 2), [root], {
      order: 2,
      role: 'user',
    });
    await expect(
      branchForEdit(sql, 'org_1', 'user_1', 'b1', 'm_edit'),
    ).resolves.toEqual({ id: 'b_new', parentId: 'thread_1', forkSequence: 2 });
    expect(stamps(statements)).toEqual(['thread_1', 'thread_1', 2]);
    // The rows still copy from the sibling on screen — an identical prefix.
    expect(copiedFrom(statements)).toEqual([
      'b_new',
      expect.any(Number),
      'b1',
      1,
    ]);
  });

  it('edit BEFORE the sibling’s fork walks up too — that prefix is the parent’s', async () => {
    const { sql, statements } = drive(sibling('b1', 'thread_1', 4), [root], {
      order: 2,
      role: 'user',
    });
    await expect(
      branchForEdit(sql, 'org_1', 'user_1', 'b1', 'm_edit'),
    ).resolves.toMatchObject({ parentId: 'thread_1', forkSequence: 2 });
    expect(stamps(statements)).toEqual(['thread_1', 'thread_1', 2]);
  });

  it('edit AFTER the sibling’s fork stays on the sibling — those rows are its own', async () => {
    const { sql, statements } = drive(sibling('b1', 'thread_1', 2), [root], {
      order: 4,
      role: 'user',
    });
    await expect(
      branchForEdit(sql, 'org_1', 'user_1', 'b1', 'm_edit'),
    ).resolves.toMatchObject({ parentId: 'b1', forkSequence: 4 });
    expect(stamps(statements)).toEqual(['thread_1', 'b1', 4]);
    expect(statements.some(isAncestorRead)).toBe(false);
  });

  it('walks a chain written before this rule up to the turn’s owner', async () => {
    const { sql, statements } = drive(
      sibling('b2', 'b1', 2),
      [{ id: 'b1', branchParentId: 'thread_1', branchForkSequence: 2 }, root],
      { order: 2, role: 'user' },
    );
    await expect(
      branchForEdit(sql, 'org_1', 'user_1', 'b2', 'm_edit'),
    ).resolves.toMatchObject({ parentId: 'thread_1' });
    expect(stamps(statements)).toEqual(['thread_1', 'thread_1', 2]);
  });

  it('stops at the last live node when an ancestor is gone', async () => {
    const { sql, statements } = drive(sibling('b2', 'b1', 2), [], {
      order: 2,
      role: 'user',
    });
    await expect(
      branchForEdit(sql, 'org_1', 'user_1', 'b2', 'm_edit'),
    ).resolves.toMatchObject({ parentId: 'b2' });
    expect(stamps(statements)).toEqual(['thread_1', 'b2', 2]);
  });

  it('a second "try again" hangs off the first one’s parent — three replies of one turn', async () => {
    const { sql, statements } = drive(
      sibling('b1', 'thread_1', 2),
      [root],
      { order: 3, role: 'assistant' },
      { order: 2 },
    );
    await expect(
      branchForRegenerate(sql, 'org_1', 'user_1', 'b1', 'm_reply'),
    ).resolves.toEqual({ id: 'b_new', parentId: 'thread_1', forkSequence: 2 });
    expect(stamps(statements)).toEqual(['thread_1', 'thread_1', 2]);
    // Through the prompt, from the sibling on screen.
    expect(copiedFrom(statements)).toEqual([
      'b_new',
      expect.any(Number),
      'b1',
      2,
    ]);
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
