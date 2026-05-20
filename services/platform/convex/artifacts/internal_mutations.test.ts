// Regression gate for the artifact_create double-insert bug
// (https://github.com/anthropics/[...]). The tool's onInputDelta and
// execute hooks each call createArtifact in its own Convex transaction;
// the mutation must dedup on `toolCallId` so a race between the two
// produces exactly one row.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    internalMutation: (config: Record<string, unknown>) => config,
  };
});

import { createArtifact } from './internal_mutations';

interface FakeArtifactRow {
  _id: string;
  organizationId: string;
  threadId: string;
  type: string;
  title: string;
  language?: string;
  content: string;
  revision: number;
  liveStreamMode?: 'create' | 'rewrite' | 'patch';
  toolCallId?: string;
  createdByMessageId?: string;
  lastEditedByMessageId?: string;
  streamingContent?: string;
  streamingPatches?: unknown;
  liveStreamStartedAt?: number;
  updatedAt?: number;
  createdAt?: number;
}

interface MockCtxOptions {
  artifactRows?: FakeArtifactRow[];
}

interface MutHandler<TArgs, TReturn> {
  handler: (ctx: unknown, args: TArgs) => Promise<TReturn> | TReturn;
}

function asyncIter<T>(rows: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const r of rows) yield r;
    },
  };
}

function createMockCtx(opts: MockCtxOptions = {}) {
  const artifactRows: FakeArtifactRow[] = [...(opts.artifactRows ?? [])];
  const insertedRows: Array<{
    table: string;
    payload: Record<string, unknown>;
    insertedId: string;
  }> = [];
  const patchedRows: Array<{ id: string; patch: Record<string, unknown> }> = [];
  let nextInsertId = 1;

  function makeBuilder() {
    const eqs: Record<string, unknown> = {};
    const builder: Record<string | symbol, unknown> = {};
    builder.withIndex = vi.fn((_name: string, cb: (q: unknown) => unknown) => {
      const q = {
        eq: (field: string, value: unknown) => {
          eqs[field] = value;
          return q;
        },
      };
      cb(q);
      return builder;
    });
    builder[Symbol.asyncIterator] = function () {
      const orgId = eqs.organizationId;
      const threadId = eqs.threadId;
      const filtered = artifactRows.filter(
        (r) => r.organizationId === orgId && r.threadId === threadId,
      );
      return asyncIter(filtered)[Symbol.asyncIterator]();
    };
    return builder;
  }

  return {
    ctx: {
      db: {
        query: vi.fn(() => makeBuilder()),
        insert: vi.fn(
          async (table: string, payload: Record<string, unknown>) => {
            const insertedId =
              table === 'artifacts'
                ? `art_${nextInsertId++}`
                : `rev_${nextInsertId++}`;
            insertedRows.push({ table, payload, insertedId });
            if (table === 'artifacts') {
              artifactRows.push({
                _id: insertedId,
                organizationId: payload.organizationId as string,
                threadId: payload.threadId as string,
                type: payload.type as string,
                title: payload.title as string,
                content: payload.content as string,
                revision: payload.revision as number,
                liveStreamMode: payload.liveStreamMode as
                  | 'create'
                  | 'rewrite'
                  | 'patch'
                  | undefined,
                toolCallId: payload.toolCallId as string | undefined,
              });
            }
            return insertedId;
          },
        ),
        patch: vi.fn(async (id: string, patch: Record<string, unknown>) => {
          patchedRows.push({ id, patch });
          const row = artifactRows.find((r) => r._id === id);
          if (row !== undefined) Object.assign(row, patch);
        }),
        get: vi.fn(),
      },
    },
    insertedRows,
    patchedRows,
    artifactRows,
  };
}

type CreateArtifactArgs = {
  organizationId: string;
  threadId: string;
  type:
    | 'html'
    | 'svg'
    | 'markdown'
    | 'mermaid'
    | 'code'
    | 'python_runnable'
    | 'node_runnable';
  title: string;
  language?: string;
  content: string;
  createdByMessageId: string;
  liveStreamMode?: 'create' | 'rewrite' | 'patch';
  toolCallId?: string;
};

const baseArgs: CreateArtifactArgs = {
  organizationId: 'org_alpha',
  threadId: 'thr_main',
  type: 'code',
  title: 'hello',
  content: 'console.log("hi")',
  createdByMessageId: 'msg_1',
};

const mut = createArtifact as unknown as MutHandler<
  CreateArtifactArgs,
  { artifactId: string; revision: number }
>;

describe('createArtifact', () => {
  it('inserts a settled row + revision when no toolCallId is provided', async () => {
    const { ctx, insertedRows } = createMockCtx();
    const result = await mut.handler(ctx, baseArgs);
    expect(result).toEqual({ artifactId: 'art_1', revision: 1 });
    const artifactInserts = insertedRows.filter((r) => r.table === 'artifacts');
    const revInserts = insertedRows.filter(
      (r) => r.table === 'artifactRevisions',
    );
    expect(artifactInserts).toHaveLength(1);
    expect(revInserts).toHaveLength(1);
    expect(artifactInserts[0]?.payload).toMatchObject({
      content: 'console.log("hi")',
      revision: 1,
      title: 'hello',
    });
    expect(artifactInserts[0]?.payload).not.toHaveProperty(
      'liveStreamMode',
      'create',
    );
  });

  it('streaming insert (placeholder) writes empty content and no revision row', async () => {
    const { ctx, insertedRows } = createMockCtx();
    const result = await mut.handler(ctx, {
      ...baseArgs,
      liveStreamMode: 'create',
      toolCallId: 'tc_a',
    });
    expect(result).toEqual({ artifactId: 'art_1', revision: 1 });
    const artifactInserts = insertedRows.filter((r) => r.table === 'artifacts');
    const revInserts = insertedRows.filter(
      (r) => r.table === 'artifactRevisions',
    );
    expect(artifactInserts).toHaveLength(1);
    expect(revInserts).toHaveLength(0);
    expect(artifactInserts[0]?.payload).toMatchObject({
      content: '',
      liveStreamMode: 'create',
      streamingContent: 'console.log("hi")',
      toolCallId: 'tc_a',
    });
  });

  it('streaming caller returns existing row when toolCallId already present (duplicate onInputDelta)', async () => {
    const existing: FakeArtifactRow = {
      _id: 'art_existing',
      organizationId: 'org_alpha',
      threadId: 'thr_main',
      type: 'code',
      title: 'hello',
      content: '',
      revision: 1,
      liveStreamMode: 'create',
      toolCallId: 'tc_dup',
    };
    const { ctx, insertedRows, patchedRows } = createMockCtx({
      artifactRows: [existing],
    });
    const result = await mut.handler(ctx, {
      ...baseArgs,
      liveStreamMode: 'create',
      toolCallId: 'tc_dup',
    });
    expect(result).toEqual({ artifactId: 'art_existing', revision: 1 });
    expect(insertedRows).toHaveLength(0);
    expect(patchedRows).toHaveLength(0);
  });

  it('settle caller finalizes existing placeholder in place (no second insert)', async () => {
    const existing: FakeArtifactRow = {
      _id: 'art_existing',
      organizationId: 'org_alpha',
      threadId: 'thr_main',
      type: 'code',
      title: 'hello',
      content: '',
      revision: 1,
      liveStreamMode: 'create',
      toolCallId: 'tc_race',
    };
    const { ctx, insertedRows, patchedRows } = createMockCtx({
      artifactRows: [existing],
    });
    const result = await mut.handler(ctx, {
      ...baseArgs,
      content: 'final content',
      toolCallId: 'tc_race',
    });
    expect(result).toEqual({ artifactId: 'art_existing', revision: 1 });
    // No new artifact row inserted; one revision row appended.
    const artifactInserts = insertedRows.filter((r) => r.table === 'artifacts');
    const revInserts = insertedRows.filter(
      (r) => r.table === 'artifactRevisions',
    );
    expect(artifactInserts).toHaveLength(0);
    expect(revInserts).toHaveLength(1);
    expect(revInserts[0]?.payload).toMatchObject({
      artifactId: 'art_existing',
      revision: 1,
      content: 'final content',
      editKind: 'create',
    });
    // Placeholder patched with canonical content + cleared streaming flags.
    expect(patchedRows).toHaveLength(1);
    expect(patchedRows[0]).toMatchObject({
      id: 'art_existing',
      patch: {
        content: 'final content',
        title: 'hello',
        liveStreamMode: undefined,
        liveStreamStartedAt: undefined,
        streamingContent: undefined,
        toolCallId: undefined,
      },
    });
  });

  it('settle caller is idempotent against an already-settled row with same toolCallId', async () => {
    const existing: FakeArtifactRow = {
      _id: 'art_settled',
      organizationId: 'org_alpha',
      threadId: 'thr_main',
      type: 'code',
      title: 'hello',
      content: 'final content',
      revision: 1,
      toolCallId: 'tc_retry',
    };
    const { ctx, insertedRows, patchedRows } = createMockCtx({
      artifactRows: [existing],
    });
    const result = await mut.handler(ctx, {
      ...baseArgs,
      content: 'final content',
      toolCallId: 'tc_retry',
    });
    expect(result).toEqual({ artifactId: 'art_settled', revision: 1 });
    expect(insertedRows).toHaveLength(0);
    expect(patchedRows).toHaveLength(0);
  });

  it('settle caller inserts fresh row + revision when no placeholder exists for the toolCallId', async () => {
    const unrelated: FakeArtifactRow = {
      _id: 'art_other',
      organizationId: 'org_alpha',
      threadId: 'thr_main',
      type: 'code',
      title: 'unrelated',
      content: 'x',
      revision: 1,
      toolCallId: 'tc_other',
    };
    const { ctx, insertedRows } = createMockCtx({ artifactRows: [unrelated] });
    const result = await mut.handler(ctx, {
      ...baseArgs,
      content: 'fresh content',
      toolCallId: 'tc_fresh',
    });
    expect(result).toEqual({ artifactId: 'art_1', revision: 1 });
    const artifactInserts = insertedRows.filter((r) => r.table === 'artifacts');
    const revInserts = insertedRows.filter(
      (r) => r.table === 'artifactRevisions',
    );
    expect(artifactInserts).toHaveLength(1);
    expect(revInserts).toHaveLength(1);
    expect(artifactInserts[0]?.payload).toMatchObject({
      content: 'fresh content',
      toolCallId: 'tc_fresh',
    });
  });

  it('dedup is scoped to (org, thread) — same toolCallId in a different thread does not collide', async () => {
    const otherThread: FakeArtifactRow = {
      _id: 'art_other_thread',
      organizationId: 'org_alpha',
      threadId: 'thr_other',
      type: 'code',
      title: 'hello',
      content: '',
      revision: 1,
      liveStreamMode: 'create',
      toolCallId: 'tc_shared',
    };
    const { ctx, insertedRows } = createMockCtx({
      artifactRows: [otherThread],
    });
    const result = await mut.handler(ctx, {
      ...baseArgs,
      content: 'fresh content',
      toolCallId: 'tc_shared',
    });
    expect(result).toEqual({ artifactId: 'art_1', revision: 1 });
    const artifactInserts = insertedRows.filter((r) => r.table === 'artifacts');
    expect(artifactInserts).toHaveLength(1);
  });
});
