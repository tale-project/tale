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
