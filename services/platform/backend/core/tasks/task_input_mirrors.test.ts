/**
 * The pass a run's start makes over the copies of task inputs its worker
 * holds: what it lists, what it asks the tasks domain about, what it
 * removes, and that nothing it meets holds up the start.
 */

import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { functionRefName } from '../../../lib/shared/handlers/function-refs';

interface Entry {
  name: string;
  type: 'file' | 'dir' | 'other';
  size: number;
  mtimeMs: number;
}

const io = vi.hoisted(() => ({
  /** What each directory lists, by path. */
  dirs: {} as Record<string, Entry[] | null>,
  listings: [] as string[],
  deletes: [] as string[][],
  listFailure: undefined as Error | undefined,
  deleteSkips: [] as Array<{ path: string; reason: string }>,
  /** Holds every removal of a task directory until it settles. */
  taskDirGate: undefined as Promise<void> | undefined,
  /** The task directory whose removal fails. */
  taskDirFailure: undefined as string | undefined,
}));

vi.mock('../node_only/sandbox/helpers/session_client', () => ({
  sessionListFiles: async (_sessionId: string, dir: string) => {
    io.listings.push(dir);
    if (io.listFailure !== undefined) throw io.listFailure;
    return io.dirs[dir] ?? null;
  },
  sessionDeleteFiles: async (_sessionId: string, paths: string[]) => {
    io.deletes.push(paths);
    if (paths.some((path) => path.startsWith('/agent/workspace/tasks/'))) {
      await io.taskDirGate;
      if (paths.includes(io.taskDirFailure ?? '')) {
        throw new Error('sandbox session files delete timed out');
      }
    }
    const skipped = io.deleteSkips;
    return {
      deleted: paths.filter((path) => !skipped.some((s) => s.path === path)),
      skipped,
    };
  },
}));

const {
  MAX_INPUT_MIRRORS_PER_PASS,
  MAX_TASK_DIRS_PER_PASS,
  pruneStaleTaskInputMirrors,
  reviewInputsDir,
  TASK_DIR_RETENTION_DAYS,
} = await import('./task_input_mirrors');
const { TASK_DIRECTORY_RETENTION_MS } =
  await import('../../domains/tasks/input-mirrors');

const hash = (taskId: string) =>
  createHash('sha256').update(taskId).digest('hex');
const dir = (name: string, mtimeMs = 1_000): Entry => ({
  name,
  type: 'dir',
  size: 0,
  mtimeMs,
});

const ARGS = {
  organizationId: 'org-1',
  agentId: 'agent-scribe',
  taskId: 'task-current',
  sessionId: 'pa-agent-scribe-w2',
};

/** A task id as the platform makes them. */
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

interface Asked {
  taskIds: string[];
  reviewHashes: string[];
  taskDirIds: string[];
}

/** A ctx whose stale-copy query answers with `stale`, recording each ask. */
function makeCtx(stale: (args: Asked) => Partial<Asked>) {
  const asked: Array<Record<string, unknown>> = [];
  const ctx = {
    runQuery: async (ref: unknown, args: Asked) => {
      const name = functionRefName(ref);
      if (name !== 'tasks/agent_runs:listStaleTaskInputMirrors') {
        throw new Error(`unexpected query ${name}`);
      }
      asked.push({ ...args });
      return { taskIds: [], reviewHashes: [], taskDirIds: [], ...stale(args) };
    },
  };
  return { ctx: ctx as never, asked };
}

beforeEach(() => {
  io.dirs = {};
  io.listings = [];
  io.deletes = [];
  io.listFailure = undefined;
  io.deleteSkips = [];
  io.taskDirGate = undefined;
  io.taskDirFailure = undefined;
  // A removal a test left running reports into its own test's calls only.
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

describe('the start’s pass over the worker’s copies of task inputs', () => {
  it('removes the copies the tasks domain names stale, never the run’s own task', async () => {
    io.dirs['/agent/inputs'] = [
      dir('task-current'),
      dir('task-done'),
      dir('task-open'),
      dir('reviews'),
      { name: 'notes.txt', type: 'file', size: 3, mtimeMs: 1 },
      dir('.hidden'),
    ];
    io.dirs['/agent/inputs/reviews'] = [
      dir(hash('task-reviewed-done')),
      dir(hash('task-reviewed-open')),
      dir(hash('task-current')),
      dir('not-a-hash'),
    ];
    const { ctx, asked } = makeCtx(() => ({
      taskIds: ['task-done'],
      reviewHashes: [hash('task-reviewed-done')],
    }));

    await pruneStaleTaskInputMirrors(ctx, ARGS);

    expect(asked).toEqual([
      {
        organizationId: 'org-1',
        agentId: 'agent-scribe',
        taskIds: ['task-done', 'task-open'],
        reviewHashes: [hash('task-reviewed-done'), hash('task-reviewed-open')],
        taskDirIds: [],
      },
    ]);
    expect(io.deletes).toEqual([
      [
        '/agent/inputs/task-done',
        `/agent/inputs/reviews/${hash('task-reviewed-done')}`,
      ],
    ]);
    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining('removed 2 stale task input copies'),
    );
  });

  it('names a review’s directory as the review staging does', () => {
    expect(reviewInputsDir('task-reviewed-done')).toBe(
      `/agent/inputs/reviews/${hash('task-reviewed-done')}`,
    );
  });

  it('removes the oldest stale copies first, a bounded number per start', async () => {
    io.dirs['/agent/inputs'] = Array.from(
      { length: MAX_INPUT_MIRRORS_PER_PASS + 10 },
      (_, n) => dir(`task-${n}`, 10_000 - n),
    );
    const { ctx, asked } = makeCtx(({ taskIds }) => ({
      taskIds,
      reviewHashes: [],
    }));

    await pruneStaleTaskInputMirrors(ctx, ARGS);

    // Every copy is asked about, the least recently changed first.
    const checked = asked[0]?.taskIds as string[];
    expect(checked).toHaveLength(MAX_INPUT_MIRRORS_PER_PASS + 10);
    expect(checked[0]).toBe(`task-${MAX_INPUT_MIRRORS_PER_PASS + 9}`);
    // A bounded number goes: the oldest, task-59 down to task-10.
    expect(io.deletes[0]).toHaveLength(MAX_INPUT_MIRRORS_PER_PASS);
    expect(io.deletes[0]?.[0]).toBe(
      `/agent/inputs/task-${MAX_INPUT_MIRRORS_PER_PASS + 9}`,
    );
    expect(io.deletes[0]).not.toContain('/agent/inputs/task-0');
    // No reviews directory, so none is listed.
    expect(io.listings).toEqual(['/agent/inputs', '/agent/workspace/tasks']);
  });

  it('old copies that are still needed never hide the stale ones behind them', async () => {
    // The oldest 60 copies belong to tasks still open; the 5 newer ones are
    // stale.
    io.dirs['/agent/inputs'] = Array.from({ length: 65 }, (_, n) =>
      dir(`task-${n}`, n < 60 ? n : 10_000 + n),
    );
    const { ctx } = makeCtx(({ taskIds }) => ({
      taskIds: taskIds.filter((id) => Number(id.slice('task-'.length)) >= 60),
      reviewHashes: [],
    }));

    await pruneStaleTaskInputMirrors(ctx, ARGS);

    expect(io.deletes[0]).toEqual([
      '/agent/inputs/task-60',
      '/agent/inputs/task-61',
      '/agent/inputs/task-62',
      '/agent/inputs/task-63',
      '/agent/inputs/task-64',
    ]);
  });

  it('asks nothing and removes nothing when the worker holds no other copy', async () => {
    io.dirs['/agent/inputs'] = [dir('task-current')];
    const { ctx, asked } = makeCtx(() => ({ taskIds: [], reviewHashes: [] }));

    await pruneStaleTaskInputMirrors(ctx, ARGS);
    // A fresh worker has no inputs directory at all.
    io.dirs = {};
    await pruneStaleTaskInputMirrors(ctx, ARGS);

    expect(asked).toEqual([]);
    expect(io.deletes).toEqual([]);
  });

  it('removes nothing when every copy is still needed', async () => {
    io.dirs['/agent/inputs'] = [dir('task-open')];
    const { ctx } = makeCtx(() => ({ taskIds: [], reviewHashes: [] }));

    await pruneStaleTaskInputMirrors(ctx, ARGS);

    expect(io.deletes).toEqual([]);
  });

  it('logs what it could not do and never throws', async () => {
    const { ctx } = makeCtx(() => ({
      taskIds: ['task-done'],
      reviewHashes: [],
    }));
    io.dirs['/agent/inputs'] = [dir('task-done')];
    io.deleteSkips = [{ path: '/agent/inputs/task-done', reason: 'EACCES' }];
    await pruneStaleTaskInputMirrors(ctx, ARGS);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('/agent/inputs/task-done'),
    );

    io.listFailure = new Error('spawner unreachable');
    await expect(pruneStaleTaskInputMirrors(ctx, ARGS)).resolves.toBe(
      undefined,
    );

    io.listFailure = undefined;
    const failing = {
      runQuery: async () => {
        throw new Error('database unavailable');
      },
    };
    await expect(
      pruneStaleTaskInputMirrors(failing as never, ARGS),
    ).resolves.toBe(undefined);
    expect(console.warn).toHaveBeenCalledTimes(3);
  });
});

describe('the start’s pass over the worker’s task directories', () => {
  it('removes the directories of tasks named stale, never the run’s own or one not named like a task [TASK-R86]', async () => {
    io.dirs['/agent/workspace/tasks'] = [
      dir(uuid(1), 1_000),
      dir(uuid(2), 2_000),
      dir(uuid(3), 3_000),
      dir('scratch'),
      { name: 'notes.md', type: 'file', size: 3, mtimeMs: 1 },
    ];
    const { ctx, asked } = makeCtx(() => ({ taskDirIds: [uuid(2)] }));

    await pruneStaleTaskInputMirrors(ctx, { ...ARGS, taskId: uuid(1) });

    // The run's own task is never asked about, nor a name no task has.
    expect(asked).toEqual([
      {
        organizationId: 'org-1',
        agentId: 'agent-scribe',
        taskIds: [],
        reviewHashes: [],
        taskDirIds: [uuid(2), uuid(3)],
      },
    ]);
    await vi.waitFor(() =>
      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining(
          `removed 1 task directory from pa-agent-scribe-w2: /agent/workspace/tasks/${uuid(2)}`,
        ),
      ),
    );
    expect(io.deletes).toEqual([[`/agent/workspace/tasks/${uuid(2)}`]]);
  });

  it('never holds up the start while a directory is removed [TASK-R86]', async () => {
    io.dirs['/agent/inputs'] = [dir('task-done')];
    io.dirs['/agent/workspace/tasks'] = [dir(uuid(2))];
    let release = () => {};
    io.taskDirGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { ctx } = makeCtx(() => ({
      taskIds: ['task-done'],
      taskDirIds: [uuid(2)],
    }));

    // Resolves while the checkout is still being removed.
    await pruneStaleTaskInputMirrors(ctx, ARGS);

    expect(io.deletes).toContainEqual(['/agent/inputs/task-done']);
    expect(io.deletes).toContainEqual([`/agent/workspace/tasks/${uuid(2)}`]);
    expect(console.info).not.toHaveBeenCalledWith(
      expect.stringContaining('task director'),
    );
    release();
    await vi.waitFor(() =>
      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining('removed 1 task directory'),
      ),
    );
  });

  it('removes a bounded number, the oldest first, one at a time; a failure ends the pass [TASK-R86]', async () => {
    io.dirs['/agent/workspace/tasks'] = Array.from(
      { length: MAX_TASK_DIRS_PER_PASS + 3 },
      (_, n) => dir(uuid(n), 10_000 - n),
    );
    const { ctx } = makeCtx(({ taskDirIds }) => ({ taskDirIds }));

    await pruneStaleTaskInputMirrors(ctx, ARGS);

    await vi.waitFor(() =>
      expect(io.deletes).toHaveLength(MAX_TASK_DIRS_PER_PASS),
    );
    const oldest = MAX_TASK_DIRS_PER_PASS + 2;
    expect(io.deletes[0]).toEqual([`/agent/workspace/tasks/${uuid(oldest)}`]);
    expect(io.deletes.flat()).not.toContain(
      `/agent/workspace/tasks/${uuid(0)}`,
    );

    // The next pass: the second removal fails, and the pass stops there.
    io.deletes = [];
    io.taskDirFailure = `/agent/workspace/tasks/${uuid(oldest - 1)}`;
    await pruneStaleTaskInputMirrors(ctx, ARGS);
    await vi.waitFor(() =>
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('removing closed tasks’ directories'),
        expect.any(Error),
      ),
    );
    expect(io.deletes).toHaveLength(2);
    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining(
        `removed 1 task directory from pa-agent-scribe-w2: /agent/workspace/tasks/${uuid(oldest)}`,
      ),
    );
  });

  it('tells the agent the age the tasks domain removes an open task’s directory at [TASK-R86]', () => {
    expect(TASK_DIR_RETENTION_DAYS * 24 * 60 * 60 * 1000).toBe(
      TASK_DIRECTORY_RETENTION_MS,
    );
  });
});
