/**
 * Unit tests for the artifact-side internal queries.
 *
 * Currently covers `findArtifactByCreatedMessage`, which backs the
 * `artifact_create` same-message guard: when an assistant reply has
 * already produced an artifact, the second `artifact_create` call gets a
 * soft `already_created_in_message` conflict instead of spawning a
 * duplicate project. Empty-string `createdByMessageId` must short-circuit
 * to null so multi-step / sub-agent edge cases don't cross-match every
 * empty-string row in the thread.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    internalQuery: (config: Record<string, unknown>) => config,
  };
});

import {
  findArtifactByCreatedMessage,
  getLatestRunOutputs,
} from './internal_queries';

interface FakeArtifactRow {
  _id: string;
  organizationId: string;
  threadId: string;
  createdByMessageId?: string;
}

interface QueryHandler<TArgs, TReturn> {
  handler: (ctx: unknown, args: TArgs) => Promise<TReturn> | TReturn;
}

function createMockCtx(rows: FakeArtifactRow[]) {
  function makeBuilder() {
    const eqs: Record<string, unknown> = {};
    const matches = (): FakeArtifactRow[] =>
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
        if (
          eqs.createdByMessageId !== undefined &&
          r.createdByMessageId !== eqs.createdByMessageId
        ) {
          return false;
        }
        return true;
      });
    const builder: Record<string, unknown> = {};
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
    builder.first = vi.fn(async () => {
      const list = matches();
      return list.length > 0 ? list[0] : null;
    });
    return builder;
  }
  return {
    ctx: { db: { query: vi.fn(() => makeBuilder()) } },
  };
}

type Args = {
  organizationId: string;
  threadId: string;
  createdByMessageId: string;
};

const find = findArtifactByCreatedMessage as unknown as QueryHandler<
  Args,
  FakeArtifactRow | null
>;

describe('findArtifactByCreatedMessage', () => {
  it('returns the existing artifact row when one matches the message id', async () => {
    const { ctx } = createMockCtx([
      {
        _id: 'art_1',
        organizationId: 'org_a',
        threadId: 'thr_a',
        createdByMessageId: 'msg_1',
      },
    ]);

    const result = await find.handler(ctx, {
      organizationId: 'org_a',
      threadId: 'thr_a',
      createdByMessageId: 'msg_1',
    });

    expect(result).not.toBeNull();
    expect(result?._id).toBe('art_1');
  });

  it('returns null when no artifact was created in this message', async () => {
    const { ctx } = createMockCtx([
      {
        _id: 'art_1',
        organizationId: 'org_a',
        threadId: 'thr_a',
        createdByMessageId: 'msg_OTHER',
      },
    ]);

    const result = await find.handler(ctx, {
      organizationId: 'org_a',
      threadId: 'thr_a',
      createdByMessageId: 'msg_1',
    });

    expect(result).toBeNull();
  });

  it('returns null without touching the db when createdByMessageId is empty', async () => {
    // Empty-string `createdByMessageId` is the multi-step / sub-agent
    // fallback — guarding against it prevents a stray empty-string row in
    // the thread from cross-matching every new tool call.
    const { ctx } = createMockCtx([
      {
        _id: 'art_1',
        organizationId: 'org_a',
        threadId: 'thr_a',
        createdByMessageId: '',
      },
    ]);

    const result = await find.handler(ctx, {
      organizationId: 'org_a',
      threadId: 'thr_a',
      createdByMessageId: '',
    });

    expect(result).toBeNull();
    expect(ctx.db.query).not.toHaveBeenCalled();
  });

  it('scopes the lookup to (organizationId, threadId, createdByMessageId)', async () => {
    const { ctx } = createMockCtx([
      {
        _id: 'art_other_org',
        organizationId: 'org_OTHER',
        threadId: 'thr_a',
        createdByMessageId: 'msg_1',
      },
      {
        _id: 'art_other_thread',
        organizationId: 'org_a',
        threadId: 'thr_OTHER',
        createdByMessageId: 'msg_1',
      },
    ]);

    const result = await find.handler(ctx, {
      organizationId: 'org_a',
      threadId: 'thr_a',
      createdByMessageId: 'msg_1',
    });

    // Both candidate rows live outside the current (org, thread) scope.
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getLatestRunOutputs — pre-stage source resolution
//
// The pre-stage path that feeds /workspace/output/ in a follow-up
// `artifact_run` must NOT be defeated by intermediate runs that happen
// to be `status: 'completed'` but produced no files (e.g. a qa.py that
// exits 0 without writing anything). The walk-back has to find the
// most recent run that actually produced files, regardless of status.
// ---------------------------------------------------------------------------

interface FakeArtifactRow_ {
  _id: string;
  organizationId: string;
  type: string;
  runOutputFiles?: Array<{
    name: string;
    storageId?: string;
    size: number;
    contentType?: string;
  }>;
}

interface FakeRunRow {
  _id: string;
  _creationTime: number;
  artifactId: string;
  status: 'completed' | 'failed' | 'cancelled';
}

interface FakeRunFile {
  _id: string;
  _creationTime: number;
  runId: string;
  artifactId: string;
  name: string;
  storageId: string;
  size: number;
  contentType?: string;
}

interface FakeArtifactOutput {
  _id: string;
  artifactId: string;
  name: string;
  storageId: string;
  size: number;
  contentType?: string;
  sha256?: string;
  producedByRunId: string;
  updatedAt: number;
}

function createPreStageCtx(opts: {
  artifact: FakeArtifactRow_;
  runs: FakeRunRow[];
  runFiles: FakeRunFile[];
  artifactOutputs?: FakeArtifactOutput[];
}) {
  return {
    ctx: {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === opts.artifact._id) return opts.artifact;
          // `from_run` pin path looks up the run row by id; return it
          // so the pin branch can find its artifactId and walk runFiles.
          const run = opts.runs.find((r) => r._id === id);
          return run ?? null;
        }),
        normalizeId: vi.fn((_table: string, id: string) => id),
        query: vi.fn((table: string) => {
          const eqs: Record<string, unknown> = {};
          let order: 'asc' | 'desc' = 'asc';
          const builder: Record<string | symbol, unknown> = {};
          builder.withIndex = vi.fn(
            (_name: string, cb: (q: unknown) => unknown) => {
              const q = {
                eq: (field: string, value: unknown) => {
                  eqs[field] = value;
                  return q;
                },
              };
              cb(q);
              return builder;
            },
          );
          builder.order = vi.fn((dir: 'asc' | 'desc') => {
            order = dir;
            return builder;
          });
          // Async iterable
          builder[Symbol.asyncIterator] = async function* () {
            if (table === 'artifactRuns') {
              const rows = opts.runs
                .filter((r) => r.artifactId === eqs.artifactId)
                .sort((a, b) =>
                  order === 'desc'
                    ? b._creationTime - a._creationTime
                    : a._creationTime - b._creationTime,
                );
              for (const r of rows) yield r;
              return;
            }
            if (table === 'artifactRunFiles') {
              // Two access patterns:
              //  - by_run (used by the explicit `from_run` pin path)
              //  - by_artifact (used by the cumulative walk-back); ordered
              //    desc by _creationTime so first-occurrence-per-name wins.
              let rows = opts.runFiles;
              if (eqs.runId !== undefined) {
                rows = rows.filter((f) => f.runId === eqs.runId);
              }
              if (eqs.artifactId !== undefined) {
                rows = rows.filter((f) => f.artifactId === eqs.artifactId);
              }
              rows = [...rows].sort((a, b) =>
                order === 'desc'
                  ? b._creationTime - a._creationTime
                  : a._creationTime - b._creationTime,
              );
              for (const f of rows) yield f;
              return;
            }
            if (table === 'artifactOutputs') {
              const rows = (opts.artifactOutputs ?? []).filter(
                (o) => o.artifactId === eqs.artifactId,
              );
              for (const o of rows) yield o;
              return;
            }
          };
          return builder;
        }),
      },
    },
  };
}

const getLatest = getLatestRunOutputs as unknown as QueryHandler<
  {
    artifactId: string;
    expectedOrganizationId?: string;
    fromRun?: string;
  },
  {
    files: Array<{ name: string; storageId: string; size: number }>;
    source: string;
  }
>;

describe('getLatestRunOutputs', () => {
  it('returns files from a failed-but-with-files run when the latest completed run produced nothing', async () => {
    // The exact scenario the user reported:
    //   - Run 1 (older): main.js + qa.py multi-step. main.js wrote a
    //     pptx, qa.py crashed → overall status='failed', PPTX in
    //     artifactRunFiles.
    //   - Run 2 (newer): qa.py-only. Exits 0 with no /workspace/output
    //     writes → status='completed', empty artifactRunFiles.
    // The next pre-stage must pick up Run 1's pptx, not Run 2's empty
    // file set.
    const { ctx } = createPreStageCtx({
      artifact: {
        _id: 'art_1',
        organizationId: 'org_a',
        type: 'script_runnable',
      },
      runs: [
        {
          _id: 'run_old_failed',
          _creationTime: 1_000,
          artifactId: 'art_1',
          status: 'failed',
        },
        {
          _id: 'run_new_completed',
          _creationTime: 2_000,
          artifactId: 'art_1',
          status: 'completed',
        },
      ],
      runFiles: [
        {
          _id: 'rf_1',
          _creationTime: 1_100,
          runId: 'run_old_failed',
          artifactId: 'art_1',
          name: 'test.pptx',
          storageId: 'st_pptx',
          size: 250_000,
        },
      ],
    });

    const result = await getLatest.handler(ctx, { artifactId: 'art_1' });

    expect(result.source).toBe('artifact_run_files');
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.name).toBe('test.pptx');
    expect(result.files[0]?.storageId).toBe('st_pptx');
  });

  it('walks back through cancelled / failed runs alike, first run with files wins', async () => {
    const { ctx } = createPreStageCtx({
      artifact: {
        _id: 'art_1',
        organizationId: 'org_a',
        type: 'script_runnable',
      },
      runs: [
        {
          _id: 'run_oldest_with_file',
          _creationTime: 1_000,
          artifactId: 'art_1',
          status: 'failed',
        },
        {
          _id: 'run_middle_cancelled_empty',
          _creationTime: 2_000,
          artifactId: 'art_1',
          status: 'cancelled',
        },
        {
          _id: 'run_newest_completed_empty',
          _creationTime: 3_000,
          artifactId: 'art_1',
          status: 'completed',
        },
      ],
      runFiles: [
        {
          _id: 'rf_1',
          _creationTime: 1_100,
          runId: 'run_oldest_with_file',
          artifactId: 'art_1',
          name: 'first.txt',
          storageId: 'st_first',
          size: 100,
        },
      ],
    });

    const result = await getLatest.handler(ctx, { artifactId: 'art_1' });

    expect(result.source).toBe('artifact_run_files');
    expect(result.files[0]?.name).toBe('first.txt');
  });

  it('falls back to legacy artifacts.runOutputFiles when no run produced files', async () => {
    const { ctx } = createPreStageCtx({
      artifact: {
        _id: 'art_1',
        organizationId: 'org_a',
        type: 'script_runnable',
        runOutputFiles: [
          {
            name: 'legacy.txt',
            storageId: 'st_legacy',
            size: 50,
          },
        ],
      },
      runs: [
        {
          _id: 'run_empty',
          _creationTime: 1_000,
          artifactId: 'art_1',
          status: 'completed',
        },
      ],
      runFiles: [],
    });

    const result = await getLatest.handler(ctx, { artifactId: 'art_1' });

    expect(result.source).toBe('legacy_artifact_field');
    expect(result.files[0]?.name).toBe('legacy.txt');
  });

  it('returns none when both walk-back and legacy field are empty', async () => {
    const { ctx } = createPreStageCtx({
      artifact: {
        _id: 'art_1',
        organizationId: 'org_a',
        type: 'script_runnable',
      },
      runs: [],
      runFiles: [],
    });

    const result = await getLatest.handler(ctx, { artifactId: 'art_1' });

    expect(result.source).toBe('none');
    expect(result.files).toHaveLength(0);
  });

  it('respects expectedOrganizationId IDOR check', async () => {
    const { ctx } = createPreStageCtx({
      artifact: {
        _id: 'art_1',
        organizationId: 'org_a',
        type: 'script_runnable',
      },
      runs: [],
      runFiles: [],
    });

    const result = await getLatest.handler(ctx, {
      artifactId: 'art_1',
      expectedOrganizationId: 'org_OTHER',
    });

    expect(result.source).toBe('none');
    expect(result.files).toHaveLength(0);
  });

  // ---------------------------------------------------------------------
  // Cumulative-state invariant (crispy-curry plan Defect 1).
  //
  // The old walk-back returned a single run's files. If Run 1 produced
  // foo.pptx and Run 2 produced only bar.txt (no foo.pptx), the next
  // pre-stage saw Run 2 first and returned [bar.txt] — losing foo.pptx
  // from /workspace/output/ even though it still existed in _storage.
  //
  // The new walk-back reduces newest-name-wins across runs, so Run 3 sees
  // BOTH foo.pptx and bar.txt. This is the regression for the user's
  // exact reported failure mode.
  // ---------------------------------------------------------------------

  it('accumulates files across runs even when newer runs produced different filenames (no-shadow invariant)', async () => {
    const { ctx } = createPreStageCtx({
      artifact: {
        _id: 'art_1',
        organizationId: 'org_a',
        type: 'script_runnable',
      },
      runs: [
        {
          _id: 'run_1',
          _creationTime: 1_000,
          artifactId: 'art_1',
          status: 'completed',
        },
        {
          _id: 'run_2',
          _creationTime: 2_000,
          artifactId: 'art_1',
          status: 'completed',
        },
      ],
      runFiles: [
        {
          _id: 'rf_old',
          _creationTime: 1_100,
          runId: 'run_1',
          artifactId: 'art_1',
          name: 'foo.pptx',
          storageId: 'st_foo',
          size: 250_000,
        },
        {
          _id: 'rf_new',
          _creationTime: 2_100,
          runId: 'run_2',
          artifactId: 'art_1',
          name: 'bar.txt',
          storageId: 'st_bar',
          size: 50,
        },
      ],
    });

    const result = await getLatest.handler(ctx, { artifactId: 'art_1' });

    expect(result.source).toBe('artifact_run_files');
    // Both files should be visible — newer-different-filename must not
    // shadow earlier output.
    expect(result.files.map((f) => f.name).sort()).toEqual([
      'bar.txt',
      'foo.pptx',
    ]);
    // Walk-back path signals lazy-derive is needed so the next read
    // hits the manifest table directly.
    expect(
      (result as unknown as { needsManifestDerive: boolean })
        .needsManifestDerive,
    ).toBe(true);
  });

  it('takes newest-by-creation-time when the same filename appears across runs', async () => {
    const { ctx } = createPreStageCtx({
      artifact: {
        _id: 'art_1',
        organizationId: 'org_a',
        type: 'script_runnable',
      },
      runs: [
        {
          _id: 'run_1',
          _creationTime: 1_000,
          artifactId: 'art_1',
          status: 'completed',
        },
        {
          _id: 'run_2',
          _creationTime: 2_000,
          artifactId: 'art_1',
          status: 'completed',
        },
      ],
      runFiles: [
        {
          _id: 'rf_old',
          _creationTime: 1_100,
          runId: 'run_1',
          artifactId: 'art_1',
          name: 'report.txt',
          storageId: 'st_old',
          size: 10,
        },
        {
          _id: 'rf_new',
          _creationTime: 2_100,
          runId: 'run_2',
          artifactId: 'art_1',
          name: 'report.txt',
          storageId: 'st_new',
          size: 20,
        },
      ],
    });

    const result = await getLatest.handler(ctx, { artifactId: 'art_1' });

    expect(result.source).toBe('artifact_run_files');
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.name).toBe('report.txt');
    expect(result.files[0]?.storageId).toBe('st_new');
  });

  // ---------------------------------------------------------------------
  // Manifest precedence (crispy-curry plan §1).
  //
  // Once the artifact has any rows in `artifactOutputs`, the cumulative
  // manifest is the source of truth — the walk-back fallback is
  // bypassed. `needsManifestDerive` should be false because no
  // lazy-derive is needed.
  // ---------------------------------------------------------------------

  it('reads from artifactOutputs manifest when present, skipping the run-files walk-back', async () => {
    const { ctx } = createPreStageCtx({
      artifact: {
        _id: 'art_1',
        organizationId: 'org_a',
        type: 'script_runnable',
      },
      runs: [
        {
          _id: 'run_stale',
          _creationTime: 1_000,
          artifactId: 'art_1',
          status: 'completed',
        },
      ],
      // The walk-back would have surfaced this file. The manifest takes
      // precedence; we should NEVER see `walked_only.txt` in the result.
      runFiles: [
        {
          _id: 'rf_walked',
          _creationTime: 1_100,
          runId: 'run_stale',
          artifactId: 'art_1',
          name: 'walked_only.txt',
          storageId: 'st_walked',
          size: 10,
        },
      ],
      artifactOutputs: [
        {
          _id: 'ao_1',
          artifactId: 'art_1',
          name: 'manifest_a.txt',
          storageId: 'st_a',
          size: 100,
          sha256: 'deadbeef',
          producedByRunId: 'run_x',
          updatedAt: 5_000,
        },
        {
          _id: 'ao_2',
          artifactId: 'art_1',
          name: 'manifest_b.txt',
          storageId: 'st_b',
          size: 200,
          producedByRunId: 'run_y',
          updatedAt: 6_000,
        },
      ],
    });

    const result = await getLatest.handler(ctx, { artifactId: 'art_1' });

    expect(result.source).toBe('artifact_outputs');
    expect(result.files.map((f) => f.name).sort()).toEqual([
      'manifest_a.txt',
      'manifest_b.txt',
    ]);
    // Manifest path → no derive needed.
    expect(
      (result as unknown as { needsManifestDerive: boolean })
        .needsManifestDerive,
    ).toBe(false);
    // sha256 from the manifest is preserved through the query.
    const a = result.files.find((f) => f.name === 'manifest_a.txt');
    expect((a as unknown as { sha256?: string } | undefined)?.sha256).toBe(
      'deadbeef',
    );
  });

  // ---------------------------------------------------------------------
  // `from_run` pin still scopes to a single run's files (crispy-curry plan §1).
  // The pin is a positive lever — "give me the state run X produced" —
  // so it deliberately bypasses the cumulative manifest.
  // ---------------------------------------------------------------------

  it("from_run pin returns only that one run's files, ignoring the cumulative manifest", async () => {
    const { ctx } = createPreStageCtx({
      artifact: {
        _id: 'art_1',
        organizationId: 'org_a',
        type: 'script_runnable',
      },
      runs: [
        {
          _id: 'run_pinned',
          _creationTime: 1_000,
          artifactId: 'art_1',
          status: 'completed',
        },
        {
          _id: 'run_other',
          _creationTime: 2_000,
          artifactId: 'art_1',
          status: 'completed',
        },
      ],
      runFiles: [
        {
          _id: 'rf_pinned',
          _creationTime: 1_100,
          runId: 'run_pinned',
          artifactId: 'art_1',
          name: 'pinned.txt',
          storageId: 'st_pinned',
          size: 10,
        },
        {
          _id: 'rf_other',
          _creationTime: 2_100,
          runId: 'run_other',
          artifactId: 'art_1',
          name: 'other.txt',
          storageId: 'st_other',
          size: 20,
        },
      ],
      artifactOutputs: [
        {
          _id: 'ao_1',
          artifactId: 'art_1',
          name: 'manifest.txt',
          storageId: 'st_manifest',
          size: 100,
          producedByRunId: 'run_other',
          updatedAt: 5_000,
        },
      ],
    });

    const result = await getLatest.handler(ctx, {
      artifactId: 'art_1',
      fromRun: 'run_pinned',
    });

    expect(result.source).toBe('artifact_run_files');
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.name).toBe('pinned.txt');
  });
});
