import { ConvexError } from 'convex/values';
import { describe, expect, it, vi } from 'vitest';

import { normalizeTopicKey } from './constants';
import {
  findActiveEntryByTopicKey,
  markEntryChainDeleted,
  upsertEntryRow,
  validateTopicAndContent,
} from './helpers';

interface FakeEntryRow {
  _id: string;
  organizationId: string;
  topic: string;
  topicKey: string;
  content: string;
  status: 'active' | 'superseded';
  documentId?: string;
  source: 'chat' | 'manual';
  createdBy: string;
  createdAt: number;
  supersededBy?: string;
  supersededAt?: number;
  deletedAt?: number;
}

function createMockCtx(rows: FakeEntryRow[]) {
  let nextId = rows.length + 1;
  const inserted: Array<Record<string, unknown>> = [];
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];

  function matchingRows(constraints: Record<string, unknown>) {
    return rows.filter((row) =>
      Object.entries(constraints).every(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test helper reads dynamic fields off the fake row
        ([field, value]) =>
          (row as unknown as Record<string, unknown>)[field] === value,
      ),
    );
  }

  const ctx = {
    db: {
      query: vi.fn((table: string) => {
        expect(table).toBe('knowledgeEntries');
        return {
          withIndex: (_name: string, cb: (q: unknown) => unknown) => {
            const constraints: Record<string, unknown> = {};
            const builder = {
              eq: (field: string, value: unknown) => {
                constraints[field] = value;
                return builder;
              },
            };
            cb(builder);
            const matched = matchingRows(constraints);
            return {
              first: async () => matched[0] ?? null,
              async *[Symbol.asyncIterator]() {
                for (const row of matched) yield row;
              },
            };
          },
        };
      }),
      insert: vi.fn(async (_table: string, doc: Record<string, unknown>) => {
        const id = `entry-${nextId++}`;
        inserted.push({ _id: id, ...doc });
        return id;
      }),
      patch: vi.fn(async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
        const row = rows.find((r) => r._id === id);
        if (row) Object.assign(row, patch);
      }),
    },
  };

  return { ctx, inserted, patches };
}

// oxlint-disable-next-line typescript/no-explicit-any -- the fake ctx is structurally compatible with the MutationCtx surface the helpers use
const asCtx = (ctx: unknown) => ctx as any;

function makeRow(overrides: Partial<FakeEntryRow> = {}): FakeEntryRow {
  return {
    _id: 'entry-1',
    organizationId: 'org-1',
    topic: 'Store hours',
    topicKey: 'store hours',
    content: 'Open 9-5',
    status: 'active',
    source: 'chat',
    createdBy: 'user-1',
    createdAt: 1000,
    ...overrides,
  };
}

describe('normalizeTopicKey', () => {
  it('lowercases', () => {
    expect(normalizeTopicKey('Store Hours')).toBe('store hours');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeTopicKey('  Return policy  ')).toBe('return policy');
  });

  it('collapses internal whitespace', () => {
    expect(normalizeTopicKey('Store \t  Hours\n today')).toBe(
      'store hours today',
    );
  });

  it('maps equivalent spellings to the same key', () => {
    expect(normalizeTopicKey('STORE   hours ')).toBe(
      normalizeTopicKey('store Hours'),
    );
  });
});

describe('validateTopicAndContent', () => {
  it('trims and returns normalized topicKey', () => {
    const result = validateTopicAndContent('  Store Hours ', ' Open 9-5 ');
    expect(result.topic).toBe('Store Hours');
    expect(result.topicKey).toBe('store hours');
    expect(result.content).toBe('Open 9-5');
  });

  // #2000: validation rejects with structured ConvexError codes (not raw
  // `Error`), so the client receives a readable code instead of an opaque
  // "Server Error".
  function codeOf(fn: () => unknown): string | undefined {
    try {
      fn();
    } catch (err) {
      if (!(err instanceof ConvexError)) return undefined;
      const data: unknown = err.data;
      if (typeof data !== 'object' || data === null || !('code' in data)) {
        return undefined;
      }
      const candidate: unknown = data.code;
      return typeof candidate === 'string' ? candidate : undefined;
    }
    return undefined;
  }

  it('rejects empty topic', () => {
    expect(codeOf(() => validateTopicAndContent('   ', 'content'))).toBe(
      'KNOWLEDGE_ENTRY_TOPIC_REQUIRED',
    );
  });

  it('rejects topic over the cap', () => {
    expect(
      codeOf(() => validateTopicAndContent('x'.repeat(121), 'content')),
    ).toBe('KNOWLEDGE_ENTRY_TOPIC_TOO_LONG');
  });

  it('rejects empty content', () => {
    expect(codeOf(() => validateTopicAndContent('topic', '   '))).toBe(
      'KNOWLEDGE_ENTRY_CONTENT_REQUIRED',
    );
  });

  it('rejects content over the cap', () => {
    expect(
      codeOf(() => validateTopicAndContent('topic', 'x'.repeat(8001))),
    ).toBe('KNOWLEDGE_ENTRY_CONTENT_TOO_LONG');
  });
});

describe('findActiveEntryByTopicKey', () => {
  it('returns the active row', async () => {
    const { ctx } = createMockCtx([makeRow()]);
    const found = await findActiveEntryByTopicKey(
      asCtx(ctx),
      'org-1',
      'store hours',
    );
    expect(found?._id).toBe('entry-1');
  });

  it('ignores soft-deleted rows', async () => {
    const { ctx } = createMockCtx([makeRow({ deletedAt: 5000 })]);
    const found = await findActiveEntryByTopicKey(
      asCtx(ctx),
      'org-1',
      'store hours',
    );
    expect(found).toBeNull();
  });

  it('returns null for an unknown topic', async () => {
    const { ctx } = createMockCtx([makeRow()]);
    const found = await findActiveEntryByTopicKey(
      asCtx(ctx),
      'org-1',
      'return policy',
    );
    expect(found).toBeNull();
  });
});

describe('upsertEntryRow', () => {
  it('inserts a fresh active row when no active entry exists', async () => {
    const { ctx, inserted, patches } = createMockCtx([]);
    const result = await upsertEntryRow(asCtx(ctx), {
      organizationId: 'org-1',
      topic: 'Store hours',
      topicKey: 'store hours',
      content: 'Open 9-5',
      source: 'chat',
      createdBy: 'user-1',
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0].status).toBe('active');
    expect(inserted[0].documentId).toBeUndefined();
    expect(result.replacedEntryId).toBeNull();
    expect(result.documentId).toBeNull();
    expect(patches).toHaveLength(0);
  });

  it('supersedes the existing active row and carries its documentId', async () => {
    const existing = makeRow({ documentId: 'doc-1' });
    const { ctx, inserted, patches } = createMockCtx([existing]);

    const result = await upsertEntryRow(asCtx(ctx), {
      organizationId: 'org-1',
      topic: 'Store hours',
      topicKey: 'store hours',
      content: 'Open 10-6 now',
      source: 'manual',
      createdBy: 'user-2',
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0].status).toBe('active');
    expect(inserted[0].documentId).toBe('doc-1');
    expect(inserted[0].content).toBe('Open 10-6 now');

    expect(result.replacedEntryId).toBe('entry-1');
    expect(result.documentId).toBe('doc-1');

    expect(patches).toHaveLength(1);
    expect(patches[0].id).toBe('entry-1');
    expect(patches[0].patch.status).toBe('superseded');
    expect(patches[0].patch.supersededBy).toBe(result.entryId);
    expect(typeof patches[0].patch.supersededAt).toBe('number');
  });

  it('treats a soft-deleted active row as absent (no resurrection)', async () => {
    const { ctx, inserted, patches } = createMockCtx([
      makeRow({ deletedAt: 5000, documentId: 'doc-1' }),
    ]);

    const result = await upsertEntryRow(asCtx(ctx), {
      organizationId: 'org-1',
      topic: 'Store hours',
      topicKey: 'store hours',
      content: 'Open again',
      source: 'chat',
      createdBy: 'user-1',
    });

    expect(inserted[0].documentId).toBeUndefined();
    expect(result.replacedEntryId).toBeNull();
    expect(patches).toHaveLength(0);
  });
});

describe('markEntryChainDeleted', () => {
  it('soft-deletes every live row of the chain', async () => {
    const rows = [
      makeRow({ _id: 'entry-1', status: 'superseded' }),
      makeRow({ _id: 'entry-2' }),
    ];
    const { ctx } = createMockCtx(rows);

    const count = await markEntryChainDeleted(
      asCtx(ctx),
      'org-1',
      'store hours',
    );
    expect(count).toBe(2);
    expect(rows[0].deletedAt).toBeDefined();
    expect(rows[1].deletedAt).toBeDefined();
  });

  it('skips rows that are already deleted', async () => {
    const rows = [
      makeRow({ _id: 'entry-1', deletedAt: 100 }),
      makeRow({ _id: 'entry-2' }),
    ];
    const { ctx, patches } = createMockCtx(rows);

    const count = await markEntryChainDeleted(
      asCtx(ctx),
      'org-1',
      'store hours',
    );
    expect(count).toBe(1);
    expect(patches).toHaveLength(1);
    expect(patches[0].id).toBe('entry-2');
    expect(rows[0].deletedAt).toBe(100);
  });
});
