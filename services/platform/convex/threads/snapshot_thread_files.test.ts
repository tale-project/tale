import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  THREAD_FILE_MAX_BYTES,
  THREAD_WORKSPACE_MAX_BYTES,
} from '../thread_files/schema';

vi.mock('../_generated/server', () => ({
  internalAction: ({ handler }: { handler: Function }) => handler,
}));

// The action references internal.* paths only as opaque function handles passed
// to ctx.runQuery/ctx.runMutation, which are mocked — so a stub graph suffices.
vi.mock('../_generated/api', () => ({
  internal: {
    thread_files: {
      internal_queries: { listThreadFiles: 'listThreadFiles' },
      internal_mutations: { upsertThreadFile: 'upsertThreadFile' },
    },
  },
  components: {},
}));

// Backend routing is exercised by the object-storage E2E suite; here the org
// resolves to no slug so every copy takes the Convex `_storage` path the
// assertions below observe.
vi.mock('../lib/helpers/org_slug', () => ({
  orgSlugFromIdOrNull: vi.fn().mockResolvedValue(null),
}));

const { snapshotThreadFiles } = await import('./snapshot_thread_files');

type Handler = (
  ctx: unknown,
  args: Record<string, unknown>,
) => Promise<{ copied: number; skipped: number; failed: number }>;
const run = snapshotThreadFiles as unknown as Handler;

type FileRow = {
  storageId: string;
  path: string;
  size: number;
  contentType: string;
  source: 'user_upload' | 'agent_write' | 'run_output';
  renderHint?: string;
  createdAt: number;
  updatedAt: number;
};

function fileRow(over: Partial<FileRow> = {}): FileRow {
  return {
    storageId: 'src_1',
    path: 'a.md',
    size: 10,
    contentType: 'text/markdown',
    source: 'agent_write',
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

interface CtxOpts {
  sourceFiles: FileRow[];
  /** storageIds whose `storage.get` should resolve null (missing blob). */
  missingBlobs?: Set<string>;
  /** paths whose `upsertThreadFile` should throw. */
  upsertThrowsForPaths?: Set<string>;
}

function makeCtx(opts: CtxOpts) {
  const upserts: Array<Record<string, unknown>> = [];
  const deleted: string[] = [];
  let storeSeq = 0;

  const ctx = {
    runQuery: vi.fn(() => Promise.resolve(opts.sourceFiles)),
    storage: {
      get: vi.fn((id: string) =>
        Promise.resolve(
          opts.missingBlobs?.has(id)
            ? null
            : ({
                id,
                type: '',
                arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
              } as unknown as Blob),
        ),
      ),
      store: vi.fn(() => {
        storeSeq += 1;
        return Promise.resolve(`new_${storeSeq}`);
      }),
      delete: vi.fn((id: string) => {
        deleted.push(id);
        return Promise.resolve();
      }),
    },
    runMutation: vi.fn((_fn: unknown, mArgs: Record<string, unknown>) => {
      if (opts.upsertThrowsForPaths?.has(mArgs.path as string)) {
        return Promise.reject(new Error('quota'));
      }
      upserts.push(mArgs);
      return Promise.resolve();
    }),
  };
  return { ctx, upserts, deleted };
}

const baseArgs = {
  sourceThreadId: 'src',
  newThreadId: 'fork',
  organizationId: 'org_1',
  userId: 'u_1',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('snapshotThreadFiles', () => {
  it('copies each source file to a FRESH storageId, preserving metadata', async () => {
    const { ctx, upserts } = makeCtx({
      sourceFiles: [
        fileRow({ path: 'a.md', storageId: 'src_a', source: 'user_upload' }),
        fileRow({
          path: 'b.py',
          storageId: 'src_b',
          source: 'agent_write',
          contentType: 'text/x-python',
          renderHint: 'code',
        }),
      ],
    });
    const out = await run(ctx, baseArgs);
    expect(out).toEqual({ copied: 2, skipped: 0, failed: 0 });
    // Fresh storageIds — never the source ids.
    expect(upserts.map((u) => u.storageId)).toEqual(['new_1', 'new_2']);
    expect(upserts.every((u) => !String(u.storageId).startsWith('src_'))).toBe(
      true,
    );
    // Provenance preserved verbatim.
    expect(upserts[0]).toMatchObject({
      path: 'a.md',
      source: 'user_upload',
      threadId: 'fork',
      organizationId: 'org_1',
    });
    expect(upserts[1]).toMatchObject({
      source: 'agent_write',
      renderHint: 'code',
    });
  });

  it('isolates a missing source blob — that file fails, the rest copy', async () => {
    const { ctx, upserts } = makeCtx({
      sourceFiles: [
        fileRow({ path: 'gone.md', storageId: 'src_gone' }),
        fileRow({ path: 'ok.md', storageId: 'src_ok' }),
      ],
      missingBlobs: new Set(['src_gone']),
    });
    const out = await run(ctx, baseArgs);
    expect(out).toEqual({ copied: 1, skipped: 0, failed: 1 });
    expect(upserts.map((u) => u.path)).toEqual(['ok.md']);
  });

  it('deletes the orphan blob and continues when an upsert throws', async () => {
    const { ctx, upserts, deleted } = makeCtx({
      sourceFiles: [
        fileRow({ path: 'bad.md', storageId: 'src_bad' }),
        fileRow({ path: 'good.md', storageId: 'src_good' }),
      ],
      upsertThrowsForPaths: new Set(['bad.md']),
    });
    const out = await run(ctx, baseArgs);
    expect(out).toEqual({ copied: 1, skipped: 0, failed: 1 });
    // The freshly-stored blob for the failed upsert is cleaned up.
    expect(deleted).toEqual(['new_1']);
    expect(upserts.map((u) => u.path)).toEqual(['good.md']);
  });

  it('skips files beyond the 100-file workspace cap', async () => {
    const sourceFiles = Array.from({ length: 101 }, (_, i) =>
      fileRow({ path: `f${i}.md`, storageId: `src_${i}`, size: 1 }),
    );
    const { ctx, upserts } = makeCtx({ sourceFiles });
    const out = await run(ctx, baseArgs);
    expect(out.copied).toBe(100);
    expect(out.skipped).toBe(1);
    expect(upserts).toHaveLength(100);
  });

  it('skips files that would exceed the workspace byte cap', async () => {
    // Enough max-size files to overflow the byte budget by exactly one —
    // derived from the constants so a cap raise can't silently retarget this
    // at the file-count branch instead.
    const fits = Math.floor(THREAD_WORKSPACE_MAX_BYTES / THREAD_FILE_MAX_BYTES);
    const { ctx } = makeCtx({
      sourceFiles: Array.from({ length: fits + 1 }, (_, i) =>
        fileRow({
          path: `big${i}`,
          storageId: `s${i}`,
          size: THREAD_FILE_MAX_BYTES,
        }),
      ),
    });
    const out = await run(ctx, baseArgs);
    expect(out.copied).toBe(fits);
    expect(out.skipped).toBe(1);
  });

  it('partial fork: copies only files last touched at or before the cutoff', async () => {
    const { ctx, upserts } = makeCtx({
      sourceFiles: [
        fileRow({ path: 'before.md', storageId: 's_b', updatedAt: 5 }),
        fileRow({ path: 'at.md', storageId: 's_a', updatedAt: 10 }),
        fileRow({ path: 'after.md', storageId: 's_x', updatedAt: 11 }),
      ],
    });
    // Cutoff = 10: keep <= 10, drop the file written after the fork point.
    const out = await run(ctx, { ...baseArgs, createdAtCutoff: 10 });
    expect(out).toEqual({ copied: 2, skipped: 0, failed: 0 });
    expect(upserts.map((u) => u.path)).toEqual(['before.md', 'at.md']);
  });

  it('partial fork: drops a pre-cutoff file edited after the cutoff (old createdAt, new updatedAt)', async () => {
    const { ctx, upserts } = makeCtx({
      sourceFiles: [
        fileRow({
          path: 'edited.md',
          storageId: 's_e',
          createdAt: 1,
          updatedAt: 50,
        }),
      ],
    });
    // Cutoff = 10: the file's content was last changed at 50 (> 10), so it must
    // not carry its post-cutoff content into the fork — even though createdAt is old.
    const out = await run(ctx, { ...baseArgs, createdAtCutoff: 10 });
    expect(out).toEqual({ copied: 0, skipped: 0, failed: 0 });
    expect(upserts).toHaveLength(0);
  });

  it('partial fork with an empty carried window (cutoff 0): copies nothing', async () => {
    const { ctx, upserts } = makeCtx({
      sourceFiles: [
        fileRow({ path: 'a.md', storageId: 's_a', updatedAt: 1 }),
        fileRow({ path: 'b.md', storageId: 's_b', updatedAt: 2 }),
      ],
    });
    const out = await run(ctx, { ...baseArgs, createdAtCutoff: 0 });
    expect(out).toEqual({ copied: 0, skipped: 0, failed: 0 });
    expect(upserts).toHaveLength(0);
  });

  it('full fork (no cutoff): copies files regardless of updatedAt', async () => {
    const { ctx, upserts } = makeCtx({
      sourceFiles: [
        fileRow({ path: 'old.md', storageId: 's_o', updatedAt: 1 }),
        fileRow({ path: 'new.md', storageId: 's_n', updatedAt: 999 }),
      ],
    });
    const out = await run(ctx, baseArgs);
    expect(out.copied).toBe(2);
    expect(upserts.map((u) => u.path)).toEqual(['old.md', 'new.md']);
  });
});
