// @vitest-environment node

/**
 * Arena's two columns must be the SAME conversation under two models: column
 * B is born with A's project filing (so both turns get the project's
 * instructions and knowledge) and a winning B keeps what the conversation
 * had on A. The real-Postgres probe rides `integration-check.ts`; this locks
 * the statements.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createAuditLog = vi.hoisted(() => vi.fn(() => Promise.resolve('log')));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));

import { ensureArenaPair, settleArenaPair } from './arena.ts';

interface Statement {
  text: string;
  values: unknown[];
}

const THREAD_A = {
  id: 'thread_a',
  organizationId: 'org_1',
  userId: 'user_1',
  title: 'Pricing question',
  kind: 'chat',
  agentSlug: 'assistant',
  harness: null,
  capabilities: { skills: ['docx'], connectors: [] },
  reasoningEffort: 'high',
  projectId: 'project_1',
  sharedWithProject: false,
  archived: false,
  pinnedAt: 5_000,
  lastReplyAt: null,
  lastReadAt: 6_000,
  isShared: false,
  shareToken: null,
  sharedAt: null,
  sharedBy: null,
  status: 'active',
  branchRootId: null,
  hidden: null,
  createdAt: 1,
  updatedAt: 1,
};

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
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- arena exercises exactly the tag, unsafe, json, and begin surfaces faked here
  return { sql: tag as unknown as Sql, statements };
}

const ARGS = {
  organizationId: 'org_1',
  userId: 'user_1',
  threadId: 'thread_a',
};

/** A finished reply written after the pair formed (`createdAt: 1`). */
const FRESH_REPLY = {
  role: 'assistant',
  model: 'model-x',
  error: null,
  status: 'complete',
  createdAt: 50,
};

const PAIR_OF = (threadId: unknown) =>
  threadId === 'thread_a'
    ? { pairId: 'pair', role: 'a', partnerThreadId: 'thread_b', createdAt: 1 }
    : { pairId: 'pair', role: 'b', partnerThreadId: 'thread_a', createdAt: 1 };

/** The settle's reads answered; `newestOf` scripts each column's newest
 * turn row (the judgeable read), `holds` the org's active legal holds,
 * everything else is empty. */
function settleSql(
  newestOf: (threadId: unknown) => unknown[],
  holds: { targetType: string; targetId: string }[] = [],
  /** What the locked read inside the transaction answers for each column
   * (`null` = the marker is gone already, i.e. the pair settled meanwhile). */
  lockedArenaOf: (threadId: string) => unknown = PAIR_OF,
) {
  return fakeSql((statement) => {
    if (statement.text.includes('FROM app.threads t')) return [THREAD_A];
    if (statement.text.includes('FROM app.legal_holds')) return holds;
    if (statement.text.includes('FOR UPDATE')) {
      return ['thread_a', 'thread_b'].map((threadId) => ({
        threadId,
        arena: lockedArenaOf(threadId),
      }));
    }
    if (statement.text.includes('SELECT arena FROM')) {
      return [{ arena: PAIR_OF(statement.values[0]) }];
    }
    if (statement.text.includes('SELECT role, model, error, status')) {
      return newestOf(statement.values[0]);
    }
    if (statement.text.includes('SELECT model FROM app.messages')) {
      return [{ model: 'model-x' }];
    }
    return [];
  });
}

/**
 * A verdict compares THIS round's two replies: a column whose newest turn
 * row is not a finished reply written since pairing — an error row, an
 * unanswered prompt, or only the copied history — has nothing to rate, so
 * the verdict is refused and nothing is written. A plain exit needs no round.
 */
/** The statements that change rows — by their leading verb, so a locked
 * read (`… FOR UPDATE`) is not mistaken for one. */
const writes = (statements: Statement[]) =>
  statements.filter((s) => /^\s*(UPDATE|INSERT)\b/.test(s.text));

describe('settleArenaPair verdict integrity', () => {
  it('refuses a verdict when one column holds only an error row, writing nothing', async () => {
    const { sql, statements } = settleSql((threadId) =>
      threadId === 'thread_a'
        ? [FRESH_REPLY]
        : [{ ...FRESH_REPLY, error: '{"code":"PROVIDER_4XX"}' }],
    );
    await expect(
      settleArenaPair(sql, { ...ARGS, verdict: 'a_better' }),
    ).resolves.toEqual({ refused: 'one_sided' });
    expect(writes(statements)).toEqual([]);
  });

  it('refuses a verdict when a column ends on an unanswered prompt', async () => {
    const { sql, statements } = settleSql((threadId) =>
      threadId === 'thread_b'
        ? [FRESH_REPLY]
        : [
            {
              role: 'user',
              model: null,
              error: null,
              status: 'complete',
              createdAt: 40,
            },
          ],
    );
    await expect(
      settleArenaPair(sql, { ...ARGS, verdict: 'tie' }),
    ).resolves.toEqual({ refused: 'one_sided' });
    expect(writes(statements)).toEqual([]);
  });

  it('refuses a verdict when a column has only the history copied at pairing', async () => {
    const { sql } = settleSql((threadId) =>
      threadId === 'thread_a'
        ? [FRESH_REPLY]
        : [{ ...FRESH_REPLY, createdAt: 1 }],
    );
    await expect(
      settleArenaPair(sql, { ...ARGS, verdict: 'b_better' }),
    ).resolves.toEqual({ refused: 'one_sided' });
  });

  it('records the verdict once both columns hold a finished reply to the round', async () => {
    const { sql, statements } = settleSql(() => [FRESH_REPLY]);
    await expect(
      settleArenaPair(sql, { ...ARGS, verdict: 'a_better' }),
    ).resolves.toEqual({ continueThreadId: 'thread_a' });
    expect(
      statements.some((s) =>
        s.text.includes('INSERT INTO app.message_feedback'),
      ),
    ).toBe(true);
  });

  it('still settles a plain exit on a one-sided round, without a feedback row', async () => {
    const { sql, statements } = settleSql(() => [
      { ...FRESH_REPLY, error: 'boom' },
    ]);
    await expect(settleArenaPair(sql, ARGS)).resolves.toEqual({
      continueThreadId: 'thread_a',
    });
    expect(
      statements.some((s) => s.text.includes('SELECT role, model, error')),
    ).toBe(false);
    expect(
      statements.some((s) =>
        s.text.includes('INSERT INTO app.message_feedback'),
      ),
    ).toBe(false);
  });
});

describe('ensureArenaPair', () => {
  it("gives column B the conversation's project filing and effort pick", async () => {
    const { sql, statements } = fakeSql((statement) => {
      if (statement.text.includes('FROM app.threads t')) return [THREAD_A];
      if (statement.text.includes('SELECT arena FROM'))
        return [{ arena: null }];
      if (statement.text.includes('INSERT INTO app.threads')) {
        return [{ id: 'thread_b' }];
      }
      return [];
    });

    await expect(ensureArenaPair(sql, ARGS)).resolves.toEqual({
      threadIdB: 'thread_b',
    });

    const birth = statements.find((s) =>
      s.text.includes('INSERT INTO app.thread_metadata'),
    );
    expect(birth?.text).toContain('project_id');
    expect(birth?.text).toContain('reasoning_effort');
    expect(birth?.values).toContain('project_1');
    expect(birth?.values).toContain('high');
    // Still a hidden lineage sibling of A — never a second row in any list.
    expect(birth?.values).toContain('thread_a');
  });
});

/** The loser's trash write (detach + status flip) and its lineage cascade. */
function trashWrites(statements: Statement[]) {
  const loser = statements.find(
    (s) =>
      s.text.includes("status = 'trashed'") &&
      s.text.includes('branch_root_id = NULL'),
  );
  const cascade = statements.find(
    (s) =>
      s.text.includes("status = 'trashed'") &&
      s.text.includes('WHERE branch_root_id = ?'),
  );
  return { loser, cascade };
}

/**
 * The losing column is discarded like a deleted chat: detached from the
 * lineage and moved to Trash in the settle transaction, never left as a
 * hidden archived row no list, search or delete can reach (2026-09-26
 * evaluation, A-09).
 */
describe('settleArenaPair discards the loser into Trash', () => {
  beforeEach(() => {
    createAuditLog.mockClear();
  });

  it('trashes the losing A as a root of its own once B has left its lineage', async () => {
    const { sql, statements } = settleSql(() => [FRESH_REPLY]);
    await expect(
      settleArenaPair(sql, { ...ARGS, verdict: 'b_better' }),
    ).resolves.toEqual({ continueThreadId: 'thread_b' });

    const { loser, cascade } = trashWrites(statements);
    expect(loser?.text).toContain('hidden = NULL');
    expect(loser?.text).toContain("AND status = 'active'");
    expect(loser?.values.slice(1)).toEqual(['thread_a', 'org_1']);
    // The edit-sibling cascade is organization-scoped like every other
    // thread_metadata write.
    expect(cascade?.values.slice(1)).toEqual(['thread_a', 'org_1']);
    // B's graduation (`branch_root_id = NULL`) runs BEFORE A's cascade, so
    // the winner never travels to Trash with the loser.
    const graduation = statements.findIndex((s) =>
      s.text.includes('UPDATE app.thread_metadata b'),
    );
    expect(graduation).toBeGreaterThanOrEqual(0);
    expect(statements.indexOf(cascade as Statement)).toBeGreaterThan(
      graduation,
    );
    expect(statements.some((s) => s.text.includes('hidden = true'))).toBe(
      false,
    );
    // The verdict rides the survivor, not the row about to be purged.
    const feedback = statements.find((s) =>
      s.text.includes('INSERT INTO app.message_feedback'),
    );
    expect(feedback?.values[1]).toBe('thread_b');
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'chat_thread.trashed',
        resourceId: 'thread_a',
        resourceName: 'Pricing question',
        metadata: { reason: 'arena_settled', verdict: 'b_better' },
      }),
    );
  });

  it('trashes the losing B, detached from A, when A wins', async () => {
    const { sql, statements } = settleSql(() => [FRESH_REPLY]);
    await expect(
      settleArenaPair(sql, { ...ARGS, verdict: 'a_better' }),
    ).resolves.toEqual({ continueThreadId: 'thread_a' });

    const { loser, cascade } = trashWrites(statements);
    expect(loser?.values.slice(1)).toEqual(['thread_b', 'org_1']);
    expect(cascade?.values.slice(1)).toEqual(['thread_b', 'org_1']);
    expect(statements.some((s) => s.text.includes('hidden = true'))).toBe(
      false,
    );
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ resourceId: 'thread_b' }),
    );
  });

  it('discards the hidden copy on a plain exit too', async () => {
    const { sql, statements } = settleSql(() => [FRESH_REPLY]);
    await expect(settleArenaPair(sql, ARGS)).resolves.toEqual({
      continueThreadId: 'thread_a',
    });
    expect(trashWrites(statements).loser?.values.slice(1)).toEqual([
      'thread_b',
      'org_1',
    ]);
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ metadata: { reason: 'arena_settled' } }),
    );
  });

  it('keeps the loser as a hidden archived root under a legal hold', async () => {
    const { sql, statements } = settleSql(
      () => [FRESH_REPLY],
      [{ targetType: 'userMembership', targetId: 'user_1' }],
    );
    await expect(
      settleArenaPair(sql, { ...ARGS, verdict: 'b_better' }),
    ).resolves.toEqual({ continueThreadId: 'thread_b' });

    expect(trashWrites(statements)).toEqual({
      loser: undefined,
      cascade: undefined,
    });
    const held = statements.find((s) =>
      s.text.includes('hidden = true, archived = true'),
    );
    expect(held?.values).toEqual(['thread_a', 'org_1']);
    expect(createAuditLog).not.toHaveBeenCalled();
  });
});

/**
 * Two settles of one pair — a double click, two tabs — used to read the
 * pair outside the transaction and both run their UPDATEs, so the second
 * trashed the first's survivor. The pair is now judged under a FOR UPDATE
 * lock on both rows, inside the transaction, and a marker already cleared
 * answers not_found with nothing written.
 */
describe('settleArenaPair under a concurrent settle', () => {
  beforeEach(() => {
    createAuditLog.mockClear();
  });

  it('locks both columns in thread-id order before judging the pair', async () => {
    const { sql, statements } = settleSql(() => [FRESH_REPLY]);
    await settleArenaPair(sql, { ...ARGS, verdict: 'b_better' });
    const lock = statements.find((s) => s.text.includes('FOR UPDATE'));
    expect(lock?.text).toContain('ORDER BY thread_id');
    expect(lock?.values).toEqual(['org_1', 'thread_a', 'thread_b']);
    // Every judgment and write comes after the lock.
    const lockAt = statements.indexOf(lock as Statement);
    for (const text of [
      'FROM app.generations',
      'SELECT role, model, error, status',
      'FROM app.legal_holds',
      "status = 'trashed'",
    ]) {
      const at = statements.findIndex((s) => s.text.includes(text));
      expect(at, text).toBeGreaterThan(lockAt);
    }
  });

  it('answers not_found and writes nothing when the marker is gone under the lock', async () => {
    const { sql, statements } = settleSql(
      () => [FRESH_REPLY],
      [],
      () => null,
    );
    await expect(
      settleArenaPair(sql, { ...ARGS, verdict: 'b_better' }),
    ).resolves.toEqual({ refused: 'not_found' });
    expect(writes(statements)).toEqual([]);
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('answers busy, clearing nothing, when the column was re-paired meanwhile', async () => {
    const { sql, statements } = settleSql(
      () => [FRESH_REPLY],
      [],
      (id) =>
        id === 'thread_a'
          ? {
              ...PAIR_OF('thread_a'),
              pairId: 'pair-2',
              partnerThreadId: 'thread_c',
            }
          : PAIR_OF(id),
    );
    await expect(settleArenaPair(sql, ARGS)).resolves.toEqual({
      refused: 'busy',
    });
    expect(writes(statements)).toEqual([]);
  });
});

describe('settleArenaPair', () => {
  it("files a winning B where A was, with A's pin and read watermark", async () => {
    const arenaOf = (threadId: unknown) =>
      threadId === 'thread_a'
        ? {
            pairId: 'pair',
            role: 'a',
            partnerThreadId: 'thread_b',
            createdAt: 1,
          }
        : {
            pairId: 'pair',
            role: 'b',
            partnerThreadId: 'thread_a',
            createdAt: 1,
          };
    const { sql, statements } = fakeSql((statement) => {
      if (statement.text.includes('FROM app.threads t')) return [THREAD_A];
      if (statement.text.includes('FOR UPDATE')) {
        return ['thread_a', 'thread_b'].map((threadId) => ({
          threadId,
          arena: arenaOf(threadId),
        }));
      }
      if (statement.text.includes('SELECT arena FROM')) {
        return [{ arena: arenaOf(statement.values[0]) }];
      }
      if (statement.text.includes('SELECT role, model, error, status')) {
        return [FRESH_REPLY];
      }
      return [];
    });

    await expect(
      settleArenaPair(sql, { ...ARGS, verdict: 'b_better' }),
    ).resolves.toEqual({ continueThreadId: 'thread_b' });

    const graduation = statements.find(
      (s) =>
        s.text.includes('UPDATE app.thread_metadata b') &&
        s.text.includes('hidden = NULL'),
    );
    expect(graduation?.text).toContain(
      'project_id = coalesce(b.project_id, a.project_id)',
    );
    expect(graduation?.text).toContain('pinned_at_ms = a.pinned_at_ms');
    expect(graduation?.text).toContain('last_read_at_ms = a.last_read_at_ms');
    expect(graduation?.values).toEqual([
      'thread_b',
      'org_1',
      'thread_a',
      'org_1',
    ]);
  });
});
