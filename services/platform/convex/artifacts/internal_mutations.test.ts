// Regression gates for the two artifact-write paths that need them:
//
//   1. `createArtifact` — title-idempotent insert (commit 511e6b361
//      changed the dedup key from `toolCallId` to a normalized title).
//      Returns either {success: true, isNew} or {success: false,
//      conflict: 'type_mismatch'}.
//
//   2. `discardActiveStreamsForThread` — the user-Stop cascade added in
//      this PR. Deletes `revision === 0` placeholders (artifact_create
//      mid-stream when the user clicked Stop) and clears streaming flags
//      on settled rows where artifact_edit/rewrite was mid-stream.

import { describe, expect, it, vi } from 'vitest';

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    internalMutation: (config: Record<string, unknown>) => config,
  };
});

import {
  appendToFile,
  createArtifact,
  discardActiveStreamsForThread,
  updateRewriteStreamingContent,
} from './internal_mutations';

interface FakeArtifactRow {
  _id: string;
  organizationId: string;
  threadId: string;
  type: string;
  title: string;
  language?: string;
  content?: string;
  files?: Array<{ path: string; content: string }>;
  entryFile?: string;
  revision: number;
  liveStreamMode?: 'create' | 'rewrite' | 'patch';
  toolCallId?: string;
  createdByMessageId?: string;
  lastEditedByMessageId?: string;
  streamingContent?: string;
  streamingPath?: string;
  liveStreamStartedAt?: number;
  createdAt?: number;
  updatedAt?: number;
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

function createMockCtx(initial: FakeArtifactRow[] = []) {
  const rows: FakeArtifactRow[] = [...initial];
  const inserted: Array<{
    table: string;
    payload: Record<string, unknown>;
    insertedId: string;
  }> = [];
  const patched: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const deleted: string[] = [];
  let next = 1;

  function makeBuilder() {
    const eqs: Record<string, unknown> = {};
    // The builder is used in two styles:
    //   - `for await (const r of ctx.db.query(...).withIndex(...))` (createArtifact)
    //   - `await ctx.db.query(...).withIndex(...).collect()`         (discardActiveStreamsForThread)
    // so we expose BOTH `[Symbol.asyncIterator]` and `.collect()`.
    const filtered = (): FakeArtifactRow[] =>
      rows.filter((r) => {
        if (
          eqs.organizationId !== undefined &&
          r.organizationId !== eqs.organizationId
        ) {
          return false;
        }
        if (eqs.threadId !== undefined && r.threadId !== eqs.threadId) {
          return false;
        }
        return true;
      });
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
    builder.collect = vi.fn(async () => filtered());
    builder.order = vi.fn((_dir: 'asc' | 'desc') => builder);
    builder[Symbol.asyncIterator] = () =>
      asyncIter(filtered())[Symbol.asyncIterator]();
    return builder;
  }

  return {
    ctx: {
      db: {
        query: vi.fn(() => makeBuilder()),
        get: vi.fn(async (id: string) => {
          return rows.find((r) => r._id === id) ?? null;
        }),
        insert: vi.fn(
          async (table: string, payload: Record<string, unknown>) => {
            const insertedId =
              table === 'artifacts' ? `art_${next++}` : `rev_${next++}`;
            inserted.push({ table, payload, insertedId });
            if (table === 'artifacts') {
              rows.push({
                _id: insertedId,
                organizationId: payload.organizationId as string,
                threadId: payload.threadId as string,
                type: payload.type as string,
                title: payload.title as string,
                language: payload.language as string | undefined,
                content: payload.content as string | undefined,
                files: payload.files as
                  | Array<{ path: string; content: string }>
                  | undefined,
                entryFile: payload.entryFile as string | undefined,
                revision: payload.revision as number,
              });
            }
            return insertedId;
          },
        ),
        patch: vi.fn(async (id: string, patch: Record<string, unknown>) => {
          patched.push({ id, patch });
          const row = rows.find((r) => r._id === id);
          if (row !== undefined) Object.assign(row, patch);
        }),
        delete: vi.fn(async (id: string) => {
          deleted.push(id);
          const idx = rows.findIndex((r) => r._id === id);
          if (idx >= 0) rows.splice(idx, 1);
        }),
      },
    },
    inserted,
    patched,
    deleted,
    rows,
  };
}

type CreateArtifactArgs = {
  organizationId: string;
  threadId: string;
  type: 'code' | 'markdown' | 'html' | 'svg' | 'mermaid';
  title: string;
  language?: string;
  content?: string;
  entryFile?: string;
  createdByMessageId: string;
};

type CreateArtifactResult =
  | {
      success: true;
      isNew: boolean;
      artifactId: string;
      revision: number;
      entryFile: string;
      filePaths: string[];
    }
  | {
      success: false;
      conflict: 'type_mismatch';
      existingArtifactId: string;
      existingType: string;
      message: string;
    };

const create = createArtifact as unknown as MutHandler<
  CreateArtifactArgs,
  CreateArtifactResult
>;

const base: CreateArtifactArgs = {
  organizationId: 'org_a',
  threadId: 'thr_a',
  type: 'code',
  title: 'hello',
  language: 'javascript',
  content: 'console.log("hi");\n',
  createdByMessageId: 'msg_1',
};

describe('createArtifact (title-idempotent insert)', () => {
  it('inserts a new artifact + revision when no row exists', async () => {
    const { ctx, inserted } = createMockCtx();
    const r = await create.handler(ctx, base);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.isNew).toBe(true);
    expect(r.revision).toBe(1);
    expect(r.filePaths).toContain(r.entryFile);
    expect(inserted.filter((i) => i.table === 'artifacts')).toHaveLength(1);
    expect(
      inserted.filter((i) => i.table === 'artifactRevisions'),
    ).toHaveLength(1);
  });

  it('returns the existing artifact (isNew=false) when title+type collide', async () => {
    const existing: FakeArtifactRow = {
      _id: 'art_existing',
      organizationId: 'org_a',
      threadId: 'thr_a',
      type: 'code',
      title: 'hello',
      content: 'old content',
      files: [{ path: 'main.js', content: 'old content' }],
      entryFile: 'main.js',
      revision: 3,
    };
    const { ctx, inserted } = createMockCtx([existing]);
    const r = await create.handler(ctx, {
      ...base,
      content: 'NEW content that should be IGNORED',
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.isNew).toBe(false);
    expect(r.artifactId).toBe('art_existing');
    expect(r.revision).toBe(3);
    // No new rows inserted — caller's content is dropped on collision.
    expect(inserted).toHaveLength(0);
  });

  it('rejects with type_mismatch when title matches but type differs', async () => {
    const existing: FakeArtifactRow = {
      _id: 'art_existing',
      organizationId: 'org_a',
      threadId: 'thr_a',
      type: 'markdown',
      title: 'hello',
      revision: 1,
    };
    const { ctx, inserted } = createMockCtx([existing]);
    const r = await create.handler(ctx, { ...base, type: 'code' });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.conflict).toBe('type_mismatch');
    expect(r.existingArtifactId).toBe('art_existing');
    expect(r.existingType).toBe('markdown');
    expect(inserted).toHaveLength(0);
  });

  it('dedup is scoped to (organizationId, threadId)', async () => {
    const otherThread: FakeArtifactRow = {
      _id: 'art_other',
      organizationId: 'org_a',
      threadId: 'thr_b',
      type: 'code',
      title: 'hello',
      revision: 1,
    };
    const { ctx, inserted } = createMockCtx([otherThread]);
    const r = await create.handler(ctx, base);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.isNew).toBe(true);
    expect(inserted.filter((i) => i.table === 'artifacts')).toHaveLength(1);
  });

  it('normalizes the comparison key (trims + collapses whitespace + case-fold)', async () => {
    const existing: FakeArtifactRow = {
      _id: 'art_existing',
      organizationId: 'org_a',
      threadId: 'thr_a',
      type: 'code',
      title: 'Hello World',
      revision: 1,
    };
    const { ctx, inserted } = createMockCtx([existing]);
    const r = await create.handler(ctx, {
      ...base,
      title: '   hello   world   ',
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.isNew).toBe(false);
    expect(r.artifactId).toBe('art_existing');
    expect(inserted).toHaveLength(0);
  });
});

type DiscardArgs = { organizationId: string; threadId: string };
type DiscardResult = { cleared: number };

const discard = discardActiveStreamsForThread as unknown as MutHandler<
  DiscardArgs,
  DiscardResult
>;

describe('discardActiveStreamsForThread (user-Stop cascade)', () => {
  it('deletes revision-0 placeholder rows with active streaming', async () => {
    const placeholder: FakeArtifactRow = {
      _id: 'art_ph',
      organizationId: 'org_a',
      threadId: 'thr_a',
      type: 'code',
      title: 'WIP',
      revision: 0,
      liveStreamMode: 'create',
      streamingContent: 'partial...',
      liveStreamStartedAt: Date.now(),
    };
    const { ctx, deleted, patched } = createMockCtx([placeholder]);
    const r = await discard.handler(ctx, {
      organizationId: 'org_a',
      threadId: 'thr_a',
    });
    expect(r.cleared).toBe(1);
    expect(deleted).toEqual(['art_ph']);
    expect(patched).toHaveLength(0);
  });

  it('clears streaming flags on settled (revision >= 1) rows', async () => {
    const settled: FakeArtifactRow = {
      _id: 'art_settled',
      organizationId: 'org_a',
      threadId: 'thr_a',
      type: 'code',
      title: 'edited',
      revision: 4,
      liveStreamMode: 'rewrite',
      streamingContent: 'new content...',
      liveStreamStartedAt: Date.now(),
    };
    const { ctx, deleted, patched } = createMockCtx([settled]);
    const r = await discard.handler(ctx, {
      organizationId: 'org_a',
      threadId: 'thr_a',
    });
    expect(r.cleared).toBe(1);
    expect(deleted).toHaveLength(0);
    expect(patched).toHaveLength(1);
    expect(patched[0]?.id).toBe('art_settled');
    // clearStreamingFlags() sets streaming-state fields to undefined.
    expect(patched[0]?.patch).toMatchObject({
      liveStreamMode: undefined,
      streamingContent: undefined,
    });
  });

  it('ignores rows without an active stream', async () => {
    const idle: FakeArtifactRow = {
      _id: 'art_idle',
      organizationId: 'org_a',
      threadId: 'thr_a',
      type: 'code',
      title: 'idle',
      revision: 2,
    };
    const { ctx, deleted, patched } = createMockCtx([idle]);
    const r = await discard.handler(ctx, {
      organizationId: 'org_a',
      threadId: 'thr_a',
    });
    expect(r.cleared).toBe(0);
    expect(deleted).toHaveLength(0);
    expect(patched).toHaveLength(0);
  });

  it('scoped to (organizationId, threadId) — does not touch other threads', async () => {
    const otherThread: FakeArtifactRow = {
      _id: 'art_other',
      organizationId: 'org_a',
      threadId: 'thr_b',
      type: 'code',
      title: 'WIP',
      revision: 0,
      liveStreamMode: 'create',
      streamingContent: 'partial',
    };
    const { ctx, deleted, patched } = createMockCtx([otherThread]);
    const r = await discard.handler(ctx, {
      organizationId: 'org_a',
      threadId: 'thr_a',
    });
    expect(r.cleared).toBe(0);
    expect(deleted).toHaveLength(0);
    expect(patched).toHaveLength(0);
  });
});

type UpdateRewriteStreamingContentArgs = {
  artifactId: string;
  toolCallId: string;
  streamingPath: string;
  content: string;
};

const updateRewriteStreaming =
  updateRewriteStreamingContent as unknown as MutHandler<
    UpdateRewriteStreamingContentArgs,
    null
  >;

describe('updateRewriteStreamingContent (incremental persistence)', () => {
  it('patches only streamingContent + updatedAt on a matching rewrite session', async () => {
    const row: FakeArtifactRow = {
      _id: 'art_rw',
      organizationId: 'org_a',
      threadId: 'thr_a',
      type: 'code',
      title: 'edit',
      revision: 5,
      liveStreamMode: 'rewrite',
      toolCallId: 'call_2',
      streamingPath: 'main.py',
      streamingContent: '',
    };
    const { ctx, patched } = createMockCtx([row]);
    await updateRewriteStreaming.handler(ctx, {
      artifactId: 'art_rw',
      toolCallId: 'call_2',
      streamingPath: 'main.py',
      content: 'rewritten so far...',
    });
    expect(patched).toHaveLength(1);
    expect(patched[0].patch.streamingContent).toBe('rewritten so far...');
    expect(typeof patched[0].patch.updatedAt).toBe('number');
  });

  it('no-ops on a streamingPath mismatch (defensive — different file in flight)', async () => {
    const row: FakeArtifactRow = {
      _id: 'art_rw',
      organizationId: 'org_a',
      threadId: 'thr_a',
      type: 'code',
      title: 'edit',
      revision: 5,
      liveStreamMode: 'rewrite',
      toolCallId: 'call_2',
      streamingPath: 'main.py',
    };
    const { ctx, patched } = createMockCtx([row]);
    await updateRewriteStreaming.handler(ctx, {
      artifactId: 'art_rw',
      toolCallId: 'call_2',
      streamingPath: 'other.py',
      content: 'stray content',
    });
    expect(patched).toHaveLength(0);
  });

  it('no-ops when the row is in create mode rather than rewrite', async () => {
    const placeholder: FakeArtifactRow = {
      _id: 'art_ph',
      organizationId: 'org_a',
      threadId: 'thr_a',
      type: 'code',
      title: 'WIP',
      revision: 0,
      liveStreamMode: 'create',
      toolCallId: 'call_2',
      streamingPath: 'main.py',
    };
    const { ctx, patched } = createMockCtx([placeholder]);
    await updateRewriteStreaming.handler(ctx, {
      artifactId: 'art_ph',
      toolCallId: 'call_2',
      streamingPath: 'main.py',
      content: 'should not land',
    });
    expect(patched).toHaveLength(0);
  });
});

type AppendToFileArgs = {
  artifactId: string;
  path: string;
  content: string;
  editedByMessageId: string;
  expectedRevision: number;
};

type AppendToFileResult =
  | {
      success: true;
      revision: number;
      path: string;
      created: boolean;
      byteLength: number;
    }
  | {
      success: false;
      code: 'not_found' | 'stale';
      message: string;
      currentRevision?: number;
    };

const append = appendToFile as unknown as MutHandler<
  AppendToFileArgs,
  AppendToFileResult
>;

describe('appendToFile (chunked content delivery)', () => {
  it('concatenates onto an existing file and bumps revision', async () => {
    const existing: FakeArtifactRow = {
      _id: 'art_1',
      organizationId: 'org_a',
      threadId: 'thr_a',
      type: 'code',
      title: 'Project',
      revision: 3,
      entryFile: 'main.py',
      files: [{ path: 'main.py', content: 'first chunk\n' }],
      content: 'first chunk\n',
    };
    const { ctx, patched, inserted } = createMockCtx([existing]);
    const r = await append.handler(ctx, {
      artifactId: 'art_1',
      path: 'main.py',
      content: 'second chunk\n',
      editedByMessageId: 'msg_x',
      expectedRevision: 3,
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.created).toBe(false);
    expect(r.revision).toBe(4);
    expect(r.byteLength).toBe('first chunk\nsecond chunk\n'.length);
    expect(patched).toHaveLength(1);
    const patchedFiles = patched[0].patch.files as Array<{
      path: string;
      content: string;
    }>;
    expect(patchedFiles[0]).toEqual({
      path: 'main.py',
      content: 'first chunk\nsecond chunk\n',
    });
    // artifactRevisions row uses editKind='append' for audit clarity.
    const revRows = inserted.filter((i) => i.table === 'artifactRevisions');
    expect(revRows).toHaveLength(1);
    expect(revRows[0].payload.editKind).toBe('append');
  });

  it('creates the file (and reports created: true) when path is missing', async () => {
    const existing: FakeArtifactRow = {
      _id: 'art_2',
      organizationId: 'org_a',
      threadId: 'thr_a',
      type: 'python_runnable',
      title: 'Project',
      revision: 1,
      entryFile: 'main.py',
      files: [{ path: 'main.py', content: '' }],
      content: '',
    };
    const { ctx, patched } = createMockCtx([existing]);
    const r = await append.handler(ctx, {
      artifactId: 'art_2',
      path: 'helpers.py',
      content: 'def helper():\n    pass\n',
      editedByMessageId: 'msg_x',
      expectedRevision: 1,
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.created).toBe(true);
    expect(r.revision).toBe(2);
    const patchedFiles = patched[0].patch.files as Array<{
      path: string;
      content: string;
    }>;
    expect(patchedFiles.map((f) => f.path)).toEqual(['main.py', 'helpers.py']);
    expect(patchedFiles[1].content).toBe('def helper():\n    pass\n');
  });

  it('rejects with code: "stale" when expectedRevision is behind (retry-safety)', async () => {
    const existing: FakeArtifactRow = {
      _id: 'art_3',
      organizationId: 'org_a',
      threadId: 'thr_a',
      type: 'code',
      title: 'Project',
      revision: 5,
      entryFile: 'main.py',
      files: [{ path: 'main.py', content: 'so far' }],
    };
    const { ctx, patched, inserted } = createMockCtx([existing]);
    const r = await append.handler(ctx, {
      artifactId: 'art_3',
      path: 'main.py',
      content: 'duplicate',
      editedByMessageId: 'msg_x',
      expectedRevision: 4,
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.code).toBe('stale');
    expect(r.currentRevision).toBe(5);
    // No write should happen on a stale rejection.
    expect(patched).toHaveLength(0);
    expect(inserted).toHaveLength(0);
  });

  it('returns code: "not_found" when the artifact row is missing', async () => {
    const { ctx, patched } = createMockCtx([]);
    const r = await append.handler(ctx, {
      artifactId: 'art_gone',
      path: 'main.py',
      content: 'anything',
      editedByMessageId: 'msg_x',
      expectedRevision: 0,
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.code).toBe('not_found');
    expect(patched).toHaveLength(0);
  });

  it('drives a multi-call append flow that yields concatenated content (sequential)', async () => {
    const initial: FakeArtifactRow = {
      _id: 'art_flow',
      organizationId: 'org_a',
      threadId: 'thr_a',
      type: 'code',
      title: 'Flow',
      revision: 1,
      entryFile: 'main.py',
      files: [{ path: 'main.py', content: '' }],
      content: '',
    };
    const { ctx } = createMockCtx([initial]);
    const chunks = ['# section 1\n', '# section 2\n', '# section 3\n'];
    let currentRev = 1;
    for (const chunk of chunks) {
      const r = await append.handler(ctx, {
        artifactId: 'art_flow',
        path: 'main.py',
        content: chunk,
        editedByMessageId: 'msg_x',
        expectedRevision: currentRev,
      });
      expect(r.success).toBe(true);
      if (!r.success) return;
      currentRev = r.revision;
    }
    expect(currentRev).toBe(4);
  });
});
