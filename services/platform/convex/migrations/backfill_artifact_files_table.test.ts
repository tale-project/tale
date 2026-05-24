// Regression gate for the Phase B backfill orphan-row fix (P0-4 from the
// crispy-curry review). Mocks the convex generated layer like
// `sandbox/internal_mutations.test.ts` so the mutation body is unit-testable
// without a running backend.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    internalMutation: (config: Record<string, unknown>) => config,
  };
});

import { apply } from './backfill_artifact_files_table';

interface MutHandler<TArgs, TReturn> {
  handler: (ctx: unknown, args: TArgs) => Promise<TReturn> | TReturn;
}

interface ArtifactRow {
  _id: string;
  files?: Array<{ path: string; content: string }>;
  runStatus?: string;
  runOutputFiles?: Array<{
    name: string;
    storageId?: string;
    size: number;
    contentType?: string;
  }>;
  revision: number;
  _phaseB_complete?: boolean;
}

function makeCtx(artifacts: ArtifactRow[]) {
  const inserted: Array<{ table: string; payload: Record<string, unknown> }> =
    [];
  const patched: Array<{ id: string; patch: Record<string, unknown> }> = [];
  // Per-table row stores so re-runs can observe prior inserts.
  const artifactFiles: Record<string, unknown>[] = [];
  const artifactRuns: Array<{ _id: string; artifactId: string }> = [];
  const artifactRunFiles: Array<{
    _id: string;
    runId: string;
    artifactId: string;
    name: string;
  }> = [];

  function makeBuilder(table: string) {
    let whereArtifactId: string | undefined;
    let whereRunId: string | undefined;
    let wherePath: string | undefined;
    let whereName: string | undefined;
    const builder: Record<string, unknown> = {};
    builder.withIndex = vi.fn((_name: string, cb: (q: unknown) => unknown) => {
      const q = {
        eq: (field: string, value: unknown) => {
          if (field === 'artifactId') whereArtifactId = value as string;
          if (field === 'runId') whereRunId = value as string;
          if (field === 'path') wherePath = value as string;
          if (field === 'name') whereName = value as string;
          return q;
        },
      };
      cb(q);
      return builder;
    });
    builder.filter = vi.fn((cb: (q: unknown) => unknown) => {
      const q = {
        eq: (_field: unknown, value: unknown) => {
          whereName = value as string;
          return q;
        },
        field: (name: string) => name,
      };
      cb(q);
      return builder;
    });
    builder.first = vi.fn(async () => {
      if (table === 'artifactFiles') {
        return (
          artifactFiles.find(
            (r) => r.artifactId === whereArtifactId && r.path === wherePath,
          ) ?? null
        );
      }
      if (table === 'artifactRuns') {
        return (
          artifactRuns.find((r) => r.artifactId === whereArtifactId) ?? null
        );
      }
      if (table === 'artifactRunFiles') {
        return (
          artifactRunFiles.find(
            (r) => r.runId === whereRunId && r.name === whereName,
          ) ?? null
        );
      }
      return null;
    });
    return builder;
  }

  let nextId = 1;
  const ctx = {
    db: {
      query: vi.fn((table: string) => {
        if (table === 'artifacts') {
          return {
            paginate: async () => ({
              page: artifacts,
              continueCursor: null,
              isDone: true,
            }),
          };
        }
        return makeBuilder(table);
      }),
      insert: vi.fn(async (table: string, payload: Record<string, unknown>) => {
        const id = `${table}_${nextId++}`;
        inserted.push({ table, payload });
        if (table === 'artifactFiles') {
          artifactFiles.push({ ...payload, _id: id });
        } else if (table === 'artifactRuns') {
          artifactRuns.push({
            ...(payload as Record<string, never>),
            _id: id,
            artifactId: payload.artifactId as string,
          });
        } else if (table === 'artifactRunFiles') {
          artifactRunFiles.push({
            _id: id,
            runId: payload.runId as string,
            artifactId: payload.artifactId as string,
            name: payload.name as string,
          });
        }
        return id;
      }),
      patch: vi.fn(async (id: string, patch: Record<string, unknown>) => {
        patched.push({ id, patch });
        const target = artifacts.find((a) => a._id === id);
        if (target !== undefined) Object.assign(target, patch);
      }),
    },
  };
  return { ctx, inserted, patched, artifacts, artifactRunFiles };
}

describe('backfill_artifact_files_table.apply', () => {
  const mut = apply as unknown as MutHandler<
    Record<string, never>,
    {
      artifacts: number;
      filesCreated: number;
      runsCreated: number;
      runFilesCreated: number;
      skipped: number;
    }
  >;

  it('writes files+runs+runFiles AND then patches the sentinel as last write', async () => {
    const artifacts: ArtifactRow[] = [
      {
        _id: 'a_1',
        files: [{ path: 'main.py', content: 'print("hi")' }],
        runStatus: 'completed',
        runOutputFiles: [
          {
            name: 'out.png',
            storageId: 'kg_1',
            size: 100,
            contentType: 'image/png',
          },
        ],
        revision: 1,
      },
    ];
    const { ctx, inserted, patched } = makeCtx(artifacts);
    const out = await mut.handler(ctx, {});

    expect(out.filesCreated).toBe(1);
    expect(out.runsCreated).toBe(1);
    expect(out.runFilesCreated).toBe(1);

    // Sentinel patch happens AFTER all inserts.
    const sentinelIndex = patched.findIndex(
      (p) => p.id === 'a_1' && p.patch._phaseB_complete === true,
    );
    expect(sentinelIndex).toBeGreaterThan(-1);
    expect(inserted.length).toBe(3); // one each of files, runs, runFiles
  });

  it('skips artifacts whose sentinel is already true (O(1) on retry)', async () => {
    const artifacts: ArtifactRow[] = [
      {
        _id: 'a_1',
        _phaseB_complete: true,
        files: [{ path: 'main.py', content: 'print("hi")' }],
        runStatus: 'completed',
        runOutputFiles: [{ name: 'out.png', storageId: 'kg_1', size: 100 }],
        revision: 1,
      },
    ];
    const { ctx, inserted, patched } = makeCtx(artifacts);
    const out = await mut.handler(ctx, {});

    expect(out.skipped).toBe(1);
    expect(out.filesCreated).toBe(0);
    expect(out.runsCreated).toBe(0);
    expect(out.runFilesCreated).toBe(0);
    expect(inserted).toHaveLength(0);
    expect(patched).toHaveLength(0);
  });

  it('on partial-prior orphan: re-uses existing artifactRuns row and fills missing artifactRunFiles', async () => {
    // Simulate a pre-sentinel partial attempt: artifactRuns row exists for
    // a_1 (orphaned because the inner artifactRunFiles loop failed mid-way),
    // but only 1 of 2 runFiles landed. Sentinel is absent. Expected:
    // re-use the existing run, insert the missing runFile, patch sentinel.
    const artifacts: ArtifactRow[] = [
      {
        _id: 'a_1',
        files: [], // already migrated, by_artifact_path check will skip
        runStatus: 'completed',
        runOutputFiles: [
          { name: 'out1.png', storageId: 'kg_1', size: 100 },
          { name: 'out2.png', storageId: 'kg_2', size: 200 },
        ],
        revision: 1,
      },
    ];
    const { ctx, inserted, patched, artifactRunFiles } = makeCtx(artifacts);
    // Seed the orphan state: one artifactRuns row + one of its runFiles.
    await ctx.db.insert('artifactRuns', {
      artifactId: 'a_1',
      status: 'completed',
      startedAt: 0,
      revision: 1,
    });
    await ctx.db.insert('artifactRunFiles', {
      runId: 'artifactRuns_1',
      artifactId: 'a_1',
      name: 'out1.png',
      storageId: 'kg_1',
      size: 100,
      createdAt: 0,
    });
    const insertedBeforeRun = inserted.length;
    const out = await mut.handler(ctx, {});

    // No new artifactRuns row (existing was reused), one new runFile.
    expect(out.runsCreated).toBe(0);
    expect(out.runFilesCreated).toBe(1);
    expect(artifactRunFiles.map((r) => r.name).sort()).toEqual([
      'out1.png',
      'out2.png',
    ]);
    // Sentinel did land.
    expect(
      patched.some((p) => p.id === 'a_1' && p.patch._phaseB_complete === true),
    ).toBe(true);
    // We only added the one missing runFile, no other extras.
    expect(inserted.length - insertedBeforeRun).toBe(1);
  });

  it('skips run synthesis for in-flight (non-terminal) status', async () => {
    const artifacts: ArtifactRow[] = [
      {
        _id: 'a_1',
        files: [{ path: 'main.py', content: 'x' }],
        runStatus: 'running',
        runOutputFiles: [{ name: 'wip.txt', storageId: 'kg_1', size: 1 }],
        revision: 1,
      },
    ];
    const { ctx, patched } = makeCtx(artifacts);
    const out = await mut.handler(ctx, {});
    expect(out.filesCreated).toBe(1);
    expect(out.runsCreated).toBe(0);
    expect(out.runFilesCreated).toBe(0);
    // Sentinel still patches (artifact is "done" for migration purposes;
    // in-flight rows have no durable run state to capture).
    expect(
      patched.some((p) => p.id === 'a_1' && p.patch._phaseB_complete === true),
    ).toBe(true);
  });
});
