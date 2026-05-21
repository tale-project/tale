/**
 * Unit tests for `selectRunsPerFile` — the pure projection helper that
 * powers the canvas `RunResultPanel`. The Convex wrapper around it
 * (`listRunsPerFile`) handles auth + row fetching only; this helper owns
 * all the logic worth verifying: latest-per-path collapsing, entry-first
 * ordering, deleted-file filtering, and the legacy single-file fallback.
 */

import { describe, expect, it } from 'vitest';

import { selectRunsPerFile } from './queries';

interface FakeArtifact {
  _id: string;
  files?: Array<{ path: string; content: string }>;
  entryFile?: string;
  revision: number;
  runStatus?: string;
  runExecutionId?: string;
  runProgress?: unknown;
  runErrorCode?: string;
  runErrorMessage?: string;
  runStdoutPreview?: string;
  runStderrPreview?: string;
  runOutputFiles?: unknown[];
  runRevision?: number;
  runExitCode?: number;
}

interface FakeExecution {
  _id: string;
  _creationTime: number;
  artifactId: string;
  path?: string;
  status: string;
  errorCode?: string;
  errorMessage?: string;
  stdoutPreview?: string;
  stderrPreview?: string;
  outputFiles?: unknown[];
  exitCode?: number;
}

// `selectRunsPerFile` is typed against `Doc<'artifacts'>` /
// `Doc<'sandboxExecutions'>`; from a unit-test point of view those are
// structurally compatible with our fakes (we only touch the fields the
// helper reads). The casts below keep the test bodies readable.
type SelectFn = (
  artifact: FakeArtifact,
  rowsNewestFirst: FakeExecution[],
  entryFile: string,
  declaredFiles: ReadonlyArray<string>,
) => Array<{
  executionId: unknown;
  path: string;
  runStatus?: string;
  runRevision?: number;
}>;

const select = selectRunsPerFile as unknown as SelectFn;

const baseArtifact: FakeArtifact = {
  _id: 'art_1',
  files: [
    { path: 'main.py', content: '' },
    { path: 'helper.py', content: '' },
    { path: 'verify.py', content: '' },
  ],
  entryFile: 'main.py',
  revision: 3,
  runExecutionId: 'exec_main_latest',
  runRevision: 3,
};

describe('selectRunsPerFile', () => {
  it('orders the result with entry file first, then declared file order', () => {
    const executions: FakeExecution[] = [
      {
        _id: 'exec_main_latest',
        _creationTime: 300,
        artifactId: 'art_1',
        path: 'main.py',
        status: 'completed',
      },
      {
        _id: 'exec_verify',
        _creationTime: 200,
        artifactId: 'art_1',
        path: 'verify.py',
        status: 'completed',
      },
      {
        _id: 'exec_helper',
        _creationTime: 100,
        artifactId: 'art_1',
        path: 'helper.py',
        status: 'completed',
      },
    ];
    const result = select(baseArtifact, executions, 'main.py', [
      'main.py',
      'helper.py',
      'verify.py',
    ]);
    expect(result.map((r) => r.path)).toEqual([
      'main.py',
      'helper.py',
      'verify.py',
    ]);
  });

  it('keeps only the newest execution per path when there are repeats', () => {
    const executions: FakeExecution[] = [
      {
        _id: 'exec_main_new',
        _creationTime: 500,
        artifactId: 'art_1',
        path: 'main.py',
        status: 'completed',
      },
      {
        _id: 'exec_main_mid',
        _creationTime: 300,
        artifactId: 'art_1',
        path: 'main.py',
        status: 'failed',
      },
      {
        _id: 'exec_main_old',
        _creationTime: 100,
        artifactId: 'art_1',
        path: 'main.py',
        status: 'completed',
      },
    ];
    const result = select(baseArtifact, executions, 'main.py', ['main.py']);
    expect(result).toHaveLength(1);
    expect(result[0].executionId).toBe('exec_main_new');
  });

  it('skips runs whose path is no longer declared (file deleted via canvas)', () => {
    const executions: FakeExecution[] = [
      {
        _id: 'exec_orphan',
        _creationTime: 200,
        artifactId: 'art_1',
        path: 'deleted.py',
        status: 'completed',
      },
      {
        _id: 'exec_main',
        _creationTime: 100,
        artifactId: 'art_1',
        path: 'main.py',
        status: 'completed',
      },
    ];
    const result = select(baseArtifact, executions, 'main.py', ['main.py']);
    expect(result.map((r) => r.path)).toEqual(['main.py']);
  });

  it('mirrors live runProgress / runRevision only onto the row matching artifact.runExecutionId', () => {
    const executions: FakeExecution[] = [
      {
        _id: 'exec_main_latest',
        _creationTime: 500,
        artifactId: 'art_1',
        path: 'main.py',
        status: 'running',
      },
      {
        _id: 'exec_helper_old',
        _creationTime: 100,
        artifactId: 'art_1',
        path: 'helper.py',
        status: 'completed',
      },
    ];
    const result = select(baseArtifact, executions, 'main.py', [
      'main.py',
      'helper.py',
    ]);
    const main = result.find((r) => r.path === 'main.py');
    const helper = result.find((r) => r.path === 'helper.py');
    // The current latest (matches artifact.runExecutionId) inherits the
    // live freshness flag; the older execution row does NOT — that's the
    // signal the canvas uses to gate stale output chrome.
    expect(main?.runRevision).toBe(3);
    expect(helper?.runRevision).toBeUndefined();
  });

  it('falls back to the artifact row when no executions exist but artifact carries runStatus (legacy)', () => {
    const legacyArtifact: FakeArtifact = {
      _id: 'art_legacy',
      files: [{ path: 'main.py', content: '' }],
      entryFile: 'main.py',
      revision: 5,
      runStatus: 'completed',
      runRevision: 5,
      runStdoutPreview: 'legacy stdout',
    };
    const result = select(legacyArtifact, [], 'main.py', ['main.py']);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('main.py');
    expect(result[0].runStatus).toBe('completed');
  });

  it('returns an empty array when nothing has ever run', () => {
    const freshArtifact: FakeArtifact = {
      _id: 'art_fresh',
      files: [{ path: 'main.py', content: '' }],
      entryFile: 'main.py',
      revision: 1,
    };
    const result = select(freshArtifact, [], 'main.py', ['main.py']);
    expect(result).toEqual([]);
  });

  it('skips executions with no `path` (legacy pre-multi-file rows)', () => {
    const executions: FakeExecution[] = [
      {
        _id: 'exec_unpathed',
        _creationTime: 500,
        artifactId: 'art_1',
        status: 'completed',
      },
      {
        _id: 'exec_main',
        _creationTime: 100,
        artifactId: 'art_1',
        path: 'main.py',
        status: 'completed',
      },
    ];
    const result = select(baseArtifact, executions, 'main.py', ['main.py']);
    expect(result).toHaveLength(1);
    expect(result[0].executionId).toBe('exec_main');
  });
});
