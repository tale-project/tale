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
//      on settled rows where artifact_file_create / artifact_file_update was mid-stream.

import { describe, expect, it, vi } from 'vitest';

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    internalMutation: (config: Record<string, unknown>) => config,
  };
});

import {
  applyFinalizeArtifactRun,
  createArtifact,
  createFileInArtifact,
  discardActiveStreamsForThread,
  updateFileInArtifact,
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
  runStatus?:
    | 'queued'
    | 'installing'
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelled';
  runExecutionId?: string;
  runStartedAt?: number;
  runRevision?: number;
  runOutputFiles?: Array<{
    name: string;
    storageId?: string;
    size: number;
    contentType?: string;
  }>;
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
  // Per-table side stores so the mock can serve queries for the auxiliary
  // tables that `syncArtifactFiles` writes to (`artifactFiles`) and any
  // future per-table reads without leaking artifact rows into a wrong-table
  // query (which previously caused `syncArtifactFiles` to delete artifact
  // rows it mistook for stale file rows).
  const auxRows = new Map<string, Record<string, unknown>[]>();
  const inserted: Array<{
    table: string;
    payload: Record<string, unknown>;
    insertedId: string;
  }> = [];
  const patched: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const deleted: string[] = [];
  let next = 1;

  function makeBuilder(table: string) {
    const eqs: Record<string, unknown> = {};
    // The builder is used in two styles:
    //   - `for await (const r of ctx.db.query(...).withIndex(...))` (createArtifact)
    //   - `await ctx.db.query(...).withIndex(...).collect()`         (discardActiveStreamsForThread)
    // so we expose BOTH `[Symbol.asyncIterator]` and `.collect()`.
    const filtered = (): Record<string, unknown>[] => {
      if (table === 'artifacts') {
        return rows.filter((r) => {
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
        }) as unknown as Record<string, unknown>[];
      }
      const tableRows = auxRows.get(table) ?? [];
      return tableRows.filter((r) => {
        for (const key of Object.keys(eqs)) {
          if (r[key] !== eqs[key]) return false;
        }
        return true;
      });
    };
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
    builder.unique = vi.fn(async () => {
      const list = filtered();
      return list.length > 0 ? list[0] : null;
    });
    builder.first = vi.fn(async () => {
      const list = filtered();
      return list.length > 0 ? list[0] : null;
    });
    builder[Symbol.asyncIterator] = () =>
      asyncIter(filtered())[Symbol.asyncIterator]();
    return builder;
  }

  return {
    ctx: {
      db: {
        query: vi.fn((table: string) => makeBuilder(table)),
        get: vi.fn(async (id: string) => {
          return rows.find((r) => r._id === id) ?? null;
        }),
        insert: vi.fn(
          async (table: string, payload: Record<string, unknown>) => {
            const insertedId =
              table === 'artifacts' ? `art_${next++}` : `${table}_${next++}`;
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
            } else {
              const tableRows = auxRows.get(table) ?? [];
              tableRows.push({ ...payload, _id: insertedId });
              auxRows.set(table, tableRows);
            }
            return insertedId;
          },
        ),
        patch: vi.fn(async (id: string, patch: Record<string, unknown>) => {
          patched.push({ id, patch });
          const row = rows.find((r) => r._id === id);
          if (row !== undefined) {
            Object.assign(row, patch);
            return;
          }
          for (const tableRows of auxRows.values()) {
            const aux = tableRows.find((r) => r._id === id);
            if (aux !== undefined) {
              Object.assign(aux, patch);
              return;
            }
          }
        }),
        delete: vi.fn(async (id: string) => {
          deleted.push(id);
          const idx = rows.findIndex((r) => r._id === id);
          if (idx >= 0) {
            rows.splice(idx, 1);
            return;
          }
          for (const [, tableRows] of auxRows) {
            const auxIdx = tableRows.findIndex((r) => r._id === id);
            if (auxIdx >= 0) {
              tableRows.splice(auxIdx, 1);
              return;
            }
          }
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

type CreateFileArgs = {
  artifactId: string;
  path: string;
  content: string;
  editedByMessageId: string;
  expectedRevision: number;
};

type CreateFileResult =
  | {
      success: true;
      revision: number;
      path: string;
      byteLength: number;
    }
  | {
      success: false;
      code: 'not_found' | 'stale' | 'path_exists';
      message: string;
      currentRevision?: number;
    };

const createFile = createFileInArtifact as unknown as MutHandler<
  CreateFileArgs,
  CreateFileResult
>;

describe('createFileInArtifact (strict-CRUD)', () => {
  it('inserts a new file and bumps revision', async () => {
    const initial: FakeArtifactRow = {
      _id: 'art_cc',
      organizationId: 'org_a',
      threadId: 'thr_a',
      type: 'code',
      title: 'Proj',
      revision: 3,
      entryFile: 'main.py',
      files: [{ path: 'main.py', content: 'print(1)\n' }],
      content: 'print(1)\n',
    };
    const { ctx, inserted } = createMockCtx([initial]);
    const r = await createFile.handler(ctx, {
      artifactId: 'art_cc',
      path: 'helpers.py',
      content: 'def x():\n  pass\n',
      editedByMessageId: 'msg_x',
      expectedRevision: 3,
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.revision).toBe(4);
    expect(r.path).toBe('helpers.py');
    expect(r.byteLength).toBe('def x():\n  pass\n'.length);
    // artifactFiles row inserted for the new path AND the pre-existing entry file.
    const fileRowInserts = inserted.filter((i) => i.table === 'artifactFiles');
    expect(
      fileRowInserts
        .map((i) => i.payload.path)
        .sort((a, b) => String(a).localeCompare(String(b))),
    ).toEqual(['helpers.py', 'main.py']);
  });

  it('refuses with code: "path_exists" when the path already exists', async () => {
    const initial: FakeArtifactRow = {
      _id: 'art_pe',
      organizationId: 'org_a',
      threadId: 'thr_a',
      type: 'code',
      title: 'Proj',
      revision: 2,
      entryFile: 'main.py',
      files: [{ path: 'main.py', content: 'print(1)\n' }],
      content: 'print(1)\n',
    };
    const { ctx, patched } = createMockCtx([initial]);
    const r = await createFile.handler(ctx, {
      artifactId: 'art_pe',
      path: 'main.py',
      content: 'something else',
      editedByMessageId: 'msg_x',
      expectedRevision: 2,
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.code).toBe('path_exists');
    expect(patched).toHaveLength(0);
  });

  it('refuses with code: "stale" on OCC mismatch', async () => {
    const initial: FakeArtifactRow = {
      _id: 'art_st',
      organizationId: 'org_a',
      threadId: 'thr_a',
      type: 'code',
      title: 'Proj',
      revision: 5,
      entryFile: 'main.py',
      files: [{ path: 'main.py', content: '' }],
      content: '',
    };
    const { ctx, patched } = createMockCtx([initial]);
    const r = await createFile.handler(ctx, {
      artifactId: 'art_st',
      path: 'helpers.py',
      content: 'x',
      editedByMessageId: 'msg_x',
      expectedRevision: 4,
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.code).toBe('stale');
    expect(r.currentRevision).toBe(5);
    expect(patched).toHaveLength(0);
  });
});

type UpdateFileArgs = CreateFileArgs;
type UpdateFileResult =
  | {
      success: true;
      revision: number;
      path: string;
      byteLength: number;
    }
  | {
      success: false;
      code: 'not_found' | 'stale' | 'file_missing';
      message: string;
      currentRevision?: number;
    };

const updateFile = updateFileInArtifact as unknown as MutHandler<
  UpdateFileArgs,
  UpdateFileResult
>;

describe('updateFileInArtifact (strict-CRUD overwrite-only)', () => {
  it('overwrites an existing file and bumps revision', async () => {
    const initial: FakeArtifactRow = {
      _id: 'art_up',
      organizationId: 'org_a',
      threadId: 'thr_a',
      type: 'code',
      title: 'Proj',
      revision: 7,
      entryFile: 'main.py',
      files: [
        { path: 'main.py', content: 'old' },
        { path: 'helpers.py', content: 'helper' },
      ],
      content: 'old',
    };
    const { ctx, patched } = createMockCtx([initial]);
    const r = await updateFile.handler(ctx, {
      artifactId: 'art_up',
      path: 'helpers.py',
      content: 'def x(): pass',
      editedByMessageId: 'msg_x',
      expectedRevision: 7,
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.revision).toBe(8);
    expect(r.path).toBe('helpers.py');
    expect(r.byteLength).toBe('def x(): pass'.length);
    // The artifact row was patched to revision 8 with the new files content.
    const artifactPatch = patched.find((p) => p.id === 'art_up');
    expect(artifactPatch?.patch.revision).toBe(8);
  });

  it('refuses with code: "file_missing" when path does not exist', async () => {
    const initial: FakeArtifactRow = {
      _id: 'art_um',
      organizationId: 'org_a',
      threadId: 'thr_a',
      type: 'code',
      title: 'Proj',
      revision: 2,
      entryFile: 'main.py',
      files: [{ path: 'main.py', content: 'print(1)\n' }],
      content: 'print(1)\n',
    };
    const { ctx, patched } = createMockCtx([initial]);
    const r = await updateFile.handler(ctx, {
      artifactId: 'art_um',
      path: 'doesnt_exist.py',
      content: 'x',
      editedByMessageId: 'msg_x',
      expectedRevision: 2,
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.code).toBe('file_missing');
    expect(patched).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// applyFinalizeArtifactRun terminal-guard semantics.
//
// The original guard "no-op when artifact row is already terminal" was too
// coarse: a follow-up run that legitimately re-finalizes the same artifact
// (because the caller forgot to invoke `initArtifactRun` between runs) had
// its `artifactRuns` / `artifactRunFiles` / `artifactOutputs` writes
// silently dropped. The fix gates the no-op on `runExecutionId` parity:
//   - same execution as the already-terminal row → duplicate, no-op
//   - different execution                       → genuinely new run, proceed
// ---------------------------------------------------------------------------

describe('applyFinalizeArtifactRun (terminal-guard executionId parity)', () => {
  it('no-ops when finalize fires twice for the SAME executionId (duplicate delta)', async () => {
    const initial: FakeArtifactRow = {
      _id: 'art_dup',
      organizationId: 'org_a',
      threadId: 'thr_a',
      type: 'script_runnable',
      title: 'dup-finalize',
      revision: 1,
      runStatus: 'completed',
      runExecutionId: 'exec_same',
    };
    const { ctx, inserted, patched } = createMockCtx([initial]);
    await applyFinalizeArtifactRun(ctx as never, {
      artifactId: 'art_dup' as never,
      runStatus: 'completed',
      runOutputFiles: [],
      runExecutionId: 'exec_same' as never,
    });
    // Guard fired — no patch to the artifact row, no inserts to the
    // dual-write tables.
    expect(patched.filter((p) => p.id === 'art_dup')).toHaveLength(0);
    expect(inserted.filter((i) => i.table === 'artifactRuns')).toHaveLength(0);
    expect(inserted.filter((i) => i.table === 'artifactRunFiles')).toHaveLength(
      0,
    );
    expect(inserted.filter((i) => i.table === 'artifactOutputs')).toHaveLength(
      0,
    );
  });

  it('proceeds when finalize fires for a DIFFERENT executionId on a terminal row (fresh run without initArtifactRun)', async () => {
    // This is the regression: a caller (test harness, direct executeCode
    // invocation, future custom path) re-uses an artifact without going
    // through `initArtifactRun`. The artifact row still carries the
    // previous run's terminal status + executionId. The new finalize MUST
    // be allowed through so its run history lands in the dual-write
    // tables.
    const initial: FakeArtifactRow = {
      _id: 'art_diff',
      organizationId: 'org_a',
      threadId: 'thr_a',
      type: 'script_runnable',
      title: 'cross-execution finalize',
      revision: 1,
      runStatus: 'completed',
      runExecutionId: 'exec_prior',
      runStartedAt: 1000,
    };
    const { ctx, inserted, patched } = createMockCtx([initial]);
    await applyFinalizeArtifactRun(ctx as never, {
      artifactId: 'art_diff' as never,
      runStatus: 'completed',
      runOutputFiles: [
        {
          name: 'out.txt',
          storageId: 'st_out' as never,
          size: 5,
          fileMetadataId: 'fm_out' as never,
          contentType: 'text/plain',
          sha256: 'abc123',
        },
      ],
      runExecutionId: 'exec_new' as never,
    });
    // Artifact row patched with the new run's state.
    const artPatches = patched.filter((p) => p.id === 'art_diff');
    expect(artPatches.length).toBeGreaterThan(0);
    expect(artPatches[0]?.patch.runStatus).toBe('completed');
    // artifactRuns row created.
    const runInserts = inserted.filter((i) => i.table === 'artifactRuns');
    expect(runInserts).toHaveLength(1);
    expect(runInserts[0]?.payload.executionId).toBe('exec_new');
    // artifactRunFiles row created.
    expect(inserted.filter((i) => i.table === 'artifactRunFiles')).toHaveLength(
      1,
    );
    // artifactOutputs manifest row created (cumulative state captured).
    const outInserts = inserted.filter((i) => i.table === 'artifactOutputs');
    expect(outInserts).toHaveLength(1);
    expect(outInserts[0]?.payload.name).toBe('out.txt');
    expect(outInserts[0]?.payload.sha256).toBe('abc123');
  });

  it('proceeds when the artifact row has no runStatus yet (first run on the artifact)', async () => {
    const initial: FakeArtifactRow = {
      _id: 'art_first',
      organizationId: 'org_a',
      threadId: 'thr_a',
      type: 'script_runnable',
      title: 'first-finalize',
      revision: 1,
    };
    const { ctx, inserted } = createMockCtx([initial]);
    await applyFinalizeArtifactRun(ctx as never, {
      artifactId: 'art_first' as never,
      runStatus: 'completed',
      runOutputFiles: [],
      runExecutionId: 'exec_first' as never,
    });
    expect(inserted.filter((i) => i.table === 'artifactRuns')).toHaveLength(1);
  });

  it("proceeds when args.runExecutionId is omitted and the row is terminal (legacy callers can't self-dedupe)", async () => {
    // Defensive: a caller that doesn't pass `runExecutionId` cannot be
    // proven to be a duplicate. We let them through; the dual-write
    // tables will gain a row but the caller is taking responsibility for
    // not double-firing.
    const initial: FakeArtifactRow = {
      _id: 'art_legacy',
      organizationId: 'org_a',
      threadId: 'thr_a',
      type: 'script_runnable',
      title: 'legacy-finalize',
      revision: 1,
      runStatus: 'completed',
      runExecutionId: 'exec_prior',
    };
    const { ctx, inserted } = createMockCtx([initial]);
    await applyFinalizeArtifactRun(ctx as never, {
      artifactId: 'art_legacy' as never,
      runStatus: 'completed',
      runOutputFiles: [],
      // runExecutionId intentionally omitted
    });
    expect(inserted.filter((i) => i.table === 'artifactRuns')).toHaveLength(1);
  });
});
