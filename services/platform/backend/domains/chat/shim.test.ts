import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  reachableHandlerNames,
  unansweredHandlerNames,
} from '../../lib/ctx-shim-reachability.ts';
import { chatShimHandlers } from './shim.ts';

/**
 * The EXHAUSTIVENESS gate for the chat lane's ctx dispatch — the twin of
 * `domains/sandbox/shim.test.ts`, on the same shared walk.
 *
 * `runChatTurn` hands the reused 0.4 `executeTurn` a ctx shim built from
 * `chatShimHandlers` alone, and the shim fails LOUD on a name it has no
 * handler for. A chat turn reaches far more than the host: the three-tool
 * executor's `rag_search` / `rag_fetch` / `web_fetch` legs, the attachment
 * gate, the composer's catalog walk, and the TTS/dictation resolvers all
 * dispatch on this one map. Before this file, `domains/chat/` had no test at
 * all, so an un-shimmed name reached an operator before it reached anyone
 * else.
 *
 * What this gate CANNOT catch is the other half of the same failure: a
 * handler that is present and answers nothing. `kind="website"` and
 * `kind="mail-attachment"` shipped as `async () => []` against tables that
 * existed, and an empty result reads exactly like a real one. That half is
 * covered by the integration checks (`backend/integration-check.ts`), which
 * seed rows and require them back.
 */

/**
 * Where a chat dispatch begins — the reused 0.4 modules each 0.5 host hands
 * this shim to. `executeTurn` has no store of its own: the Postgres turn
 * store and usage ledger (`domains/chat/store.ts`) are REQUIRED overrides,
 * so no module on this walk is excluded.
 */
const CHAT_DISPATCH = {
  entryPoints: [
    // The turn itself, and with it the whole tool executor.
    'core/chat/turn_action.ts',
    // The composer's model/voice catalog walk.
    'core/lib/providers/chat_catalog.ts',
    // Voice: TTS synthesis and dictation both resolve their model on this map.
    'core/lib/providers/resolve_tts_model.ts',
    'core/lib/providers/resolve_transcription_model.ts',
  ],
};

describe('chatShimHandlers', () => {
  // The factory only closes over `sql`; no handler runs until it is called,
  // so a stand-in is enough to enumerate the map.
  const handlers = chatShimHandlers({} as never);

  it('answers every internal function a chat turn can reach', () => {
    expect(unansweredHandlerNames(handlers, CHAT_DISPATCH)).toEqual([]);
  });

  it('reaches the search legs, not just the turn host', () => {
    // A guard on the guard: if the walk ever stops following the tool
    // executor's imports, the assertion above would pass vacuously — and the
    // legs that shipped dead are exactly the ones behind that edge.
    const reachable = reachableHandlerNames(CHAT_DISPATCH);
    expect([...reachable.keys()]).toEqual(
      expect.arrayContaining([
        'websites/internal_queries:listWebsiteSummaries',
        'file_metadata/internal_queries:listMailAttachmentsForChat',
        'tasks/search_for_chat:searchTasksForChat',
        'tasks/search_for_chat:searchProjectsForChat',
        'conversations/search_for_chat:searchConversationsForChat',
        'knowledge_entries/internal_queries:listEntriesForAgent',
      ]),
    );
  });
});

/**
 * The chat shim's entity reads must apply the same lifecycle rules the owning
 * domains do — a record the user deleted is not "current" just because the
 * assistant found it through a different door.
 */
function capturingSql(): { sql: Sql; texts: string[] } {
  const texts: string[] = [];
  const tag = (strings: TemplateStringsArray) => {
    texts.push(strings.join('?'));
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the tag call is exercised by the contact query
  return { sql: tag as unknown as Sql, texts };
}

describe("chat shim 'contacts/internal_queries:queryContacts'", () => {
  it('hides trashed contacts, like every read in the contacts domain', async () => {
    const { sql, texts } = capturingSql();
    const handlers = chatShimHandlers(sql);
    const query = handlers['contacts/internal_queries:queryContacts'];
    if (query === undefined) throw new Error('contact query handler missing');

    await query({ organizationId: 'org_1', searchTerm: 'ada' });

    const contacts = texts.find((text) => text.includes('FROM app.contacts'));
    expect(contacts).toContain("lifecycle_status IS DISTINCT FROM 'trashed'");
  });

  it('reads every user-facing field — the chat row is the only view of a contact', async () => {
    const { sql, texts } = capturingSql();
    const handlers = chatShimHandlers(sql);
    const query = handlers['contacts/internal_queries:queryContacts'];
    if (query === undefined) throw new Error('contact query handler missing');

    await query({ organizationId: 'org_1', searchTerm: 'ada' });

    const contacts = texts.find((text) => text.includes('FROM app.contacts'));
    for (const column of [
      'name',
      'email',
      'phone',
      'tags',
      'external_id AS "externalId"',
      'source',
      'locale',
      'address',
      'notes',
    ]) {
      expect(contacts).toContain(column);
    }
  });
});

describe("chat shim 'tasks/search_for_chat:searchTasksForChat'", () => {
  it('resolves the human task key the board shows, exact match first', async () => {
    // 2026-09-26 evaluation, A-05: "find TE2-1" matched only title and
    // description, so the assistant answered that no task carries that id.
    const { sql, texts } = capturingSql();
    const handlers = chatShimHandlers(sql);
    const search = handlers['tasks/search_for_chat:searchTasksForChat'];
    if (search === undefined) throw new Error('task search handler missing');

    await search({
      organizationId: 'org_1',
      projectIds: ['project_1'],
      term: 'TE2-1',
    });

    const tasks = texts.find((text) => text.includes('FROM app.tasks t'));
    expect(tasks).toContain('LEFT JOIN app.projects p ON p.id = t.project_id');
    expect(tasks).toContain('t.number');
    const keyMatch =
      "lower(coalesce(p.key || '-' || t.number::text, '')) = lower(?)";
    expect(tasks).toContain(`OR ${keyMatch}`);
    // The exact key match leads the page, before recency.
    const orderBy = `ORDER BY (? AND ${keyMatch}) DESC`;
    expect(tasks).toContain(orderBy);
    const recency = 't.updated_at_ms DESC';
    expect(tasks).toContain(recency);
    expect(tasks?.indexOf(orderBy)).toBeLessThan(tasks?.indexOf(recency) ?? -1);
  });

  it('reads the task number for the fetched task, so the key can be named', async () => {
    const { sql, texts } = capturingSql();
    const handlers = chatShimHandlers(sql);
    const byId = handlers['tasks/internal_queries:getTaskByIdInternal'];
    const context = handlers['tasks/internal_queries:getTaskContextForAgent'];
    if (byId === undefined || context === undefined) {
      throw new Error('task read handlers missing');
    }

    await byId({ taskId: 'task_1', organizationId: 'org_1' });
    await context({ taskId: 'task_1', organizationId: 'org_1' });

    const reads = texts.filter((text) => text.includes('FROM app.tasks'));
    expect(reads).toHaveLength(2);
    for (const read of reads) expect(read).toContain('number');
  });
});

describe("chat shim 'tasks/internal_queries:getTaskContextForAgent'", () => {
  const rule = {
    frequency: 'monthly',
    interval: 1,
    monthDay: 30,
    timezone: 'Europe/Zurich',
    createOn: 'dueDate',
  };

  /** Answers the task read with `task`, everything else with no rows. */
  function taskSql(task: Record<string, unknown>): Sql {
    const tag = (strings: TemplateStringsArray) =>
      Promise.resolve(
        strings.join('?').includes('discussion_thread_id') ? [task] : [],
      );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the tag call is exercised by the context read
    return tag as unknown as Sql;
  }

  it('hands task_get the schedule and the repeat rule the row stores', async () => {
    const context = chatShimHandlers(
      taskSql({
        _id: 'task_1',
        title: 'Close the books',
        status: 'todo',
        projectId: 'proj_1',
        startDate: 1_790_546_400_000,
        dueDate: 1_790_632_800_000,
        repeat: rule,
      }),
    )['tasks/internal_queries:getTaskContextForAgent'];
    if (context === undefined) throw new Error('context handler missing');
    const read = (await context({
      taskId: 'task_1',
      organizationId: 'org_1',
    })) as { task: Record<string, unknown> };
    expect(read.task).toMatchObject({
      startDate: 1_790_546_400_000,
      dueDate: 1_790_632_800_000,
      repeat: rule,
    });
  });

  it('leaves out what the task lacks, and reads a rule that no longer validates as none', async () => {
    const context = chatShimHandlers(
      taskSql({
        _id: 'task_1',
        title: 'Close the books',
        status: 'todo',
        projectId: 'proj_1',
        startDate: null,
        dueDate: null,
        repeat: { ...rule, timezone: 'Mars/Olympus_Mons' },
      }),
    )['tasks/internal_queries:getTaskContextForAgent'];
    if (context === undefined) throw new Error('context handler missing');
    const read = (await context({
      taskId: 'task_1',
      organizationId: 'org_1',
    })) as { task: Record<string, unknown> };
    for (const key of ['startDate', 'dueDate', 'repeat']) {
      expect(read.task).not.toHaveProperty(key);
    }
  });
});

describe("chat shim 'tasks/internal_queries:getTaskContextForAgent' — ids and pages", () => {
  /** Answers each statement by the table it reads, recording text and
   * values: the task (in project p-1, with a discussion thread), 51
   * subtasks, 26 blockers, and a discussion tail of 11 comments. */
  function boardSql() {
    const statements: { text: string; values: unknown[] }[] = [];
    const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
      statements.push({ text, values });
      if (text.includes('discussion_thread_id AS "discussionThreadId"')) {
        return Promise.resolve([
          {
            _id: 't-1',
            title: 'Parent',
            status: 'todo',
            projectId: 'p-1',
            discussionThreadId: 'thread-1',
          },
        ]);
      }
      if (text.includes('FROM app.projects')) {
        return Promise.resolve([
          { name: 'Fleet', key: 'FL', instructions: null },
        ]);
      }
      if (text.includes('WHERE parent_task_id')) {
        return Promise.resolve(
          Array.from({ length: 51 }, (_, index) => ({
            taskId: `sub-${index}`,
            number: index + 2,
            title: `Sub ${index}`,
            status: 'todo',
            assigneeId: null,
          })),
        );
      }
      if (text.includes('FROM app.task_dependencies')) {
        return Promise.resolve(
          Array.from({ length: 26 }, (_, index) => ({
            taskId: `blk-${index}`,
            number: null,
            title: `Blocker ${index}`,
            status: 'in_progress',
          })),
        );
      }
      if (text.includes('FROM app.messages')) {
        // The tail reads one row past the page, newest first.
        return Promise.resolve(
          Array.from({ length: 11 }, (_, index) => ({
            id: `m-${100 - index}`,
            order: 100 - index,
            stepOrder: 0,
            role: 'assistant',
            text: `Comment ${100 - index}`,
            createdAt: 1_790_000_000_000 + (100 - index),
          })),
        );
      }
      if (text.includes('FROM app.task_discussion_message_meta')) {
        const ids = values.find(Array.isArray) as string[];
        return Promise.resolve(
          ids.map((messageId) => ({
            messageId,
            authorType: 'agent',
            authorId: 'agent-1',
            editedAt: messageId === 'm-100' ? 1_790_000_009_999 : null,
            mentions: null,
            bodyByLocale: null,
          })),
        );
      }
      return Promise.resolve([]);
    };
    const sql = Object.assign(tag, { unsafe: (text: string) => text });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tag and `unsafe` are all the context read calls
    return { sql: sql as unknown as Sql, statements };
  }

  it('names every subtask, blocker and comment by id, and says where a list was cut', async () => {
    const { sql, statements } = boardSql();
    const context =
      chatShimHandlers(sql)['tasks/internal_queries:getTaskContextForAgent'];
    if (context === undefined) throw new Error('context handler missing');
    const read = (await context({
      taskId: 't-1',
      organizationId: 'org-1',
      commentLimit: 10,
      commentsBefore: 111,
    })) as Record<string, unknown>;

    const subtasks = read.subtasks as Record<string, unknown>[];
    expect(subtasks).toHaveLength(50);
    expect(subtasks[0]).toEqual({
      taskId: 'sub-0',
      number: 2,
      title: 'Sub 0',
      status: 'todo',
    });
    expect(read.subtasksTruncated).toBe(true);
    const blockedBy = read.blockedBy as Record<string, unknown>[];
    expect(blockedBy).toHaveLength(25);
    expect(blockedBy[0]).toEqual({
      taskId: 'blk-0',
      title: 'Blocker 0',
      status: 'in_progress',
    });
    expect(read.blockedByTruncated).toBe(true);

    // The comment feed's own page: newest ten, oldest first, each with its
    // id, and the order the next older page ends before.
    const comments = read.comments as Record<string, unknown>[];
    expect(comments.map((comment) => comment.commentId)).toEqual(
      Array.from({ length: 10 }, (_, index) => `m-${91 + index}`),
    );
    expect(comments.at(-1)).toEqual({
      commentId: 'm-100',
      authorType: 'agent',
      authorId: 'agent-1',
      body: 'Comment 100',
      createdAt: 1_790_000_000_100,
      editedAt: 1_790_000_009_999,
    });
    expect(read.commentsHasMore).toBe(true);
    expect(read.commentsNextBefore).toBe(91);

    // A related task is read inside the task's own project only.
    const subtaskRead = statements.find((s) =>
      s.text.includes('WHERE parent_task_id'),
    );
    expect(subtaskRead?.text).toContain('AND project_id = ?');
    expect(subtaskRead?.values).toEqual(
      expect.arrayContaining(['t-1', 'org-1', 'p-1']),
    );
    const blockerRead = statements.find((s) =>
      s.text.includes('FROM app.task_dependencies'),
    );
    expect(blockerRead?.text).toContain('AND b.project_id = ?');
    expect(blockerRead?.values).toEqual(
      expect.arrayContaining(['org-1', 'p-1']),
    );
    // The page continues before the cursor it was handed.
    const tail = statements.find((s) => s.text.includes('FROM app.messages'));
    expect(tail?.values).toEqual(expect.arrayContaining([111, 0]));
  });
});

describe("chat shim 'products/internal_queries:queryProducts'", () => {
  it('reads every user-facing field — the chat row is the only view of a product', async () => {
    const { sql, texts } = capturingSql();
    const handlers = chatShimHandlers(sql);
    const query = handlers['products/internal_queries:queryProducts'];
    if (query === undefined) throw new Error('product query handler missing');

    await query({ organizationId: 'org_1', searchTerm: 'kettle' });

    const products = texts.find((text) => text.includes('FROM app.products'));
    for (const column of [
      'name',
      'description',
      'image_url AS "imageUrl"',
      'category',
      'price',
      'currency',
      'stock',
      'tags',
      'status',
      'external_id AS "externalId"',
    ]) {
      expect(products).toContain(column);
    }
  });
});
