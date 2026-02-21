import { beforeEach, describe, it, expect } from 'vitest';

import type { QueryCtx } from '../_generated/server';

import { isGeneralThread, listThreads } from './list_threads';

// --- isGeneralThread ---

describe('isGeneralThread', () => {
  it('should return false for undefined summary', () => {
    expect(isGeneralThread(undefined)).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isGeneralThread('')).toBe(false);
  });

  it('should return false for summary without "general"', () => {
    expect(isGeneralThread('{"chatType":"workflow"}')).toBe(false);
  });

  it('should return false for invalid JSON containing "general"', () => {
    expect(isGeneralThread('not-json-general')).toBe(false);
  });

  it('should return false for null parsed value containing "general"', () => {
    expect(isGeneralThread('"general"')).toBe(false);
  });

  it('should return false for array containing "general"', () => {
    expect(isGeneralThread('["general"]')).toBe(false);
  });

  it('should return false for object with wrong chatType containing "general"', () => {
    expect(isGeneralThread('{"chatType":"not-general","note":"general"}')).toBe(
      false,
    );
  });

  it('should return true for valid general thread summary', () => {
    expect(isGeneralThread('{"chatType":"general"}')).toBe(true);
  });

  it('should return true with additional fields', () => {
    expect(
      isGeneralThread('{"chatType":"general","subThreads":{"doc":"thread_1"}}'),
    ).toBe(true);
  });
});

// --- listThreads ---

interface ThreadMetadataRow {
  _id: string;
  _creationTime: number;
  threadId: string;
  userId: string;
  chatType: 'general' | 'workflow_assistant' | 'agent_test';
  status: 'active' | 'archived';
  title?: string;
  createdAt: number;
}

let idCounter = 0;

function makeRow(overrides: {
  threadId: string;
  title?: string;
  createdAt?: number;
}): ThreadMetadataRow {
  idCounter++;
  const createdAt = overrides.createdAt ?? Date.now() - idCounter * 1000;
  return {
    _id: `metadata_${idCounter}`,
    _creationTime: createdAt,
    threadId: overrides.threadId,
    userId: 'user1',
    chatType: 'general',
    status: 'active',
    title: overrides.title ?? `Thread ${overrides.threadId}`,
    createdAt,
  };
}

function makeMockCtx(rows: ThreadMetadataRow[]): QueryCtx {
  const paginate = (opts: { cursor: string | null; numItems: number }) => {
    const startIndex = opts.cursor ? parseInt(opts.cursor, 10) : 0;
    const endIndex = startIndex + opts.numItems;
    const page = rows.slice(startIndex, endIndex);
    const isDone = endIndex >= rows.length;
    return {
      page,
      isDone,
      continueCursor: isDone ? '' : String(endIndex),
    };
  };

  const queryChain = {
    withIndex: () => queryChain,
    order: () => queryChain,
    paginate,
  };

  return {
    db: {
      query: () => queryChain,
    },
  } as unknown as QueryCtx;
}

describe('listThreads', () => {
  beforeEach(() => {
    idCounter = 0;
  });

  it('should return threads from a single page', async () => {
    const ctx = makeMockCtx([
      makeRow({ threadId: 't1' }),
      makeRow({ threadId: 't2' }),
      makeRow({ threadId: 't3' }),
    ]);

    const result = await listThreads(ctx, {
      userId: 'user1',
      paginationOpts: { cursor: null, numItems: 10 },
    });

    expect(result.page).toHaveLength(3);
    expect(result.isDone).toBe(true);
  });

  it('should map threadId to _id and createdAt to _creationTime', async () => {
    const ctx = makeMockCtx([
      makeRow({ threadId: 't1', title: 'Test Thread', createdAt: 1000 }),
    ]);

    const result = await listThreads(ctx, {
      userId: 'user1',
      paginationOpts: { cursor: null, numItems: 10 },
    });

    const thread = result.page[0];
    expect(thread._id).toBe('t1');
    expect(thread._creationTime).toBe(1000);
    expect(thread.title).toBe('Test Thread');
    expect(thread.status).toBe('active');
    expect(thread.userId).toBe('user1');
  });

  it('should only include _id, _creationTime, title, status, userId in results', async () => {
    const ctx = makeMockCtx([
      makeRow({ threadId: 't1', title: 'Test Thread' }),
    ]);

    const result = await listThreads(ctx, {
      userId: 'user1',
      paginationOpts: { cursor: null, numItems: 10 },
    });

    const thread = result.page[0];
    expect(Object.keys(thread).sort()).toEqual([
      '_creationTime',
      '_id',
      'status',
      'title',
      'userId',
    ]);
  });

  it('should paginate correctly with numItems limit', async () => {
    const ctx = makeMockCtx(
      Array.from({ length: 10 }, (_, i) => makeRow({ threadId: `t${i}` })),
    );

    const result = await listThreads(ctx, {
      userId: 'user1',
      paginationOpts: { cursor: null, numItems: 3 },
    });

    expect(result.page).toHaveLength(3);
    expect(result.isDone).toBe(false);
    expect(result.continueCursor).toBe('3');
  });

  it('should support cursor-based pagination for subsequent pages', async () => {
    const ctx = makeMockCtx(
      Array.from({ length: 5 }, (_, i) => makeRow({ threadId: `t${i}` })),
    );

    const page1 = await listThreads(ctx, {
      userId: 'user1',
      paginationOpts: { cursor: null, numItems: 3 },
    });

    expect(page1.page).toHaveLength(3);
    expect(page1.isDone).toBe(false);

    const page2 = await listThreads(ctx, {
      userId: 'user1',
      paginationOpts: { cursor: page1.continueCursor, numItems: 3 },
    });

    expect(page2.page).toHaveLength(2);
    expect(page2.isDone).toBe(true);
  });

  it('should return empty page when user has no threads', async () => {
    const ctx = makeMockCtx([]);

    const result = await listThreads(ctx, {
      userId: 'user1',
      paginationOpts: { cursor: null, numItems: 20 },
    });

    expect(result.page).toHaveLength(0);
    expect(result.isDone).toBe(true);
    expect(result.continueCursor).toBe('');
  });

  it('should set isDone to true when all results are returned', async () => {
    const ctx = makeMockCtx([
      makeRow({ threadId: 't1' }),
      makeRow({ threadId: 't2' }),
    ]);

    const result = await listThreads(ctx, {
      userId: 'user1',
      paginationOpts: { cursor: null, numItems: 10 },
    });

    expect(result.page).toHaveLength(2);
    expect(result.isDone).toBe(true);
  });
});
