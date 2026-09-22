// @vitest-environment node

/**
 * Arena's two columns must be the SAME conversation under two models: column
 * B is born with A's project filing (so both turns get the project's
 * instructions and knowledge) and a winning B keeps what the conversation
 * had on A. The real-Postgres probe rides `integration-check.ts`; this locks
 * the statements.
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

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
 * turn row (the judgeable read), everything else is empty. */
function settleSql(newestOf: (threadId: unknown) => unknown[]) {
  return fakeSql((statement) => {
    if (statement.text.includes('FROM app.threads t')) return [THREAD_A];
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
describe('settleArenaPair verdict integrity', () => {
  const writes = (statements: Statement[]) =>
    statements.filter(
      (s) => s.text.includes('UPDATE') || s.text.includes('INSERT'),
    );

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
