import { describe, expect, mock, test } from 'bun:test';

import {
  findOrphanedConvexDataVolumes,
  type OrphanedDataVolume,
} from './detect-legacy-convex-data';
import type { ExecResult } from './exec';
import {
  copyLegacyConvexDataVolume,
  type OfferLegacyMigrationDeps,
  offerLegacyConvexDataMigration,
} from './migrate-legacy-convex-data';

function ok(stdout = ''): ExecResult {
  return { success: true, stdout, stderr: '', exitCode: 0 };
}
function fail(stderr: string): ExecResult {
  return { success: false, stdout: '', stderr, exitCode: 1 };
}

interface FakeDaemonState {
  volumes: Set<string>;
  /** File count reported for a volume by the `find | wc -l` helper run. */
  counts?: Record<string, number>;
  /** Running containers reported to mount a volume (`docker ps --filter volume=`). */
  inUse?: Record<string, string[]>;
  failCopy?: boolean;
  failRm?: boolean;
}

/** Extract the volume names of every `-v name:/mnt[:ro]` mount in a run argv. */
function mountedVolumes(args: string[]): string[] {
  const names: string[] = [];
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === '-v') names.push(args[i + 1].split(':')[0]);
  }
  return names;
}

/**
 * In-memory docker daemon covering exactly the calls the migration issues:
 * volume inspect/create/rm, `ps --filter volume=`, and the two helper-
 * container runs (copy, count). Any other call is a test failure.
 */
function fakeDocker(state: FakeDaemonState) {
  const calls: string[][] = [];
  const dockerFn = (...args: string[]): Promise<ExecResult> => {
    calls.push(args);
    const [cmd, sub] = args;
    if (cmd === 'volume' && sub === 'inspect') {
      return Promise.resolve(
        state.volumes.has(args[2]) ? ok(args[2]) : fail('no such volume'),
      );
    }
    if (cmd === 'volume' && sub === 'create') {
      const name = args[args.length - 1];
      state.volumes.add(name);
      return Promise.resolve(ok(name));
    }
    if (cmd === 'volume' && sub === 'rm') {
      if (state.failRm) return Promise.resolve(fail('volume is in use'));
      state.volumes.delete(args[2]);
      return Promise.resolve(ok(args[2]));
    }
    if (cmd === 'ps') {
      const filter = args[args.indexOf('--filter') + 1];
      const name = filter.replace(/^volume=/, '');
      return Promise.resolve(ok((state.inUse?.[name] ?? []).join('\n')));
    }
    if (cmd === 'run') {
      const script = args[args.length - 1];
      const mounts = mountedVolumes(args);
      if (script.startsWith('cp ')) {
        if (state.failCopy) return Promise.resolve(fail('cp: I/O error'));
        return Promise.resolve(ok());
      }
      if (script.includes('wc -l')) {
        return Promise.resolve(ok(String(state.counts?.[mounts[0]] ?? 0)));
      }
    }
    throw new Error(`unexpected docker call: ${args.join(' ')}`);
  };
  return { dockerFn, calls };
}

const PAIR: OrphanedDataVolume = {
  legacy: 'myproj_platform-data',
  target: 'myproj_convex-data',
};

describe('copyLegacyConvexDataVolume (P1-8, #1755)', () => {
  test('creates the destination, copies, and verifies the file count', async () => {
    const state: FakeDaemonState = {
      volumes: new Set(['myproj_platform-data']),
      counts: { 'myproj_platform-data': 12, 'myproj_convex-data': 12 },
    };
    const { dockerFn, calls } = fakeDocker(state);

    await copyLegacyConvexDataVolume(PAIR, 'myproj', dockerFn);

    expect(state.volumes.has('myproj_convex-data')).toBe(true);
    const create = calls.find((c) => c[0] === 'volume' && c[1] === 'create');
    expect(create).toEqual([
      'volume',
      'create',
      '--label',
      'project=myproj',
      'myproj_convex-data',
    ]);
    const copy = calls.find(
      (c) => c[0] === 'run' && c.at(-1)?.startsWith('cp '),
    );
    // Source mounted read-only — the legacy volume must never be written.
    expect(copy).toContain('myproj_platform-data:/from:ro');
    expect(calls.some((c) => c[0] === 'volume' && c[1] === 'rm')).toBe(false);
  });

  test('never overwrites an existing destination volume', async () => {
    const state: FakeDaemonState = {
      volumes: new Set(['myproj_platform-data', 'myproj_convex-data']),
    };
    const { dockerFn, calls } = fakeDocker(state);

    await expect(
      copyLegacyConvexDataVolume(PAIR, 'myproj', dockerFn),
    ).rejects.toThrow(/already exists/);
    // Nothing was created, copied, or removed.
    expect(
      calls.filter((c) => c[0] !== 'volume' || c[1] !== 'inspect'),
    ).toEqual([]);
  });

  test('refuses while a running container mounts the legacy volume', async () => {
    const state: FakeDaemonState = {
      volumes: new Set(['myproj_platform-data']),
      inUse: { 'myproj_platform-data': ['myproj-platform-1'] },
    };
    const { dockerFn } = fakeDocker(state);

    await expect(
      copyLegacyConvexDataVolume(PAIR, 'myproj', dockerFn),
    ).rejects.toThrow(/docker compose -p myproj down/);
    expect(state.volumes.has('myproj_convex-data')).toBe(false);
  });

  test('a failed copy removes the just-created destination (stays detectable)', async () => {
    const state: FakeDaemonState = {
      volumes: new Set(['myproj_platform-data']),
      failCopy: true,
    };
    const { dockerFn } = fakeDocker(state);

    await expect(
      copyLegacyConvexDataVolume(PAIR, 'myproj', dockerFn),
    ).rejects.toThrow(/copy .* failed/);
    expect(state.volumes.has('myproj_convex-data')).toBe(false);
    // With the destination gone, the same constellation is detected again —
    // the pass is safe to simply re-run.
    const orphaned = await findOrphanedConvexDataVolumes('myproj', (name) =>
      Promise.resolve(state.volumes.has(name)),
    );
    expect(orphaned).toEqual([PAIR]);
  });

  test('a file-count mismatch rejects and removes the incomplete copy', async () => {
    const state: FakeDaemonState = {
      volumes: new Set(['myproj_platform-data']),
      counts: { 'myproj_platform-data': 12, 'myproj_convex-data': 7 },
    };
    const { dockerFn } = fakeDocker(state);

    await expect(
      copyLegacyConvexDataVolume(PAIR, 'myproj', dockerFn),
    ).rejects.toThrow(/file count mismatch/);
    expect(state.volumes.has('myproj_convex-data')).toBe(false);
  });

  test('reports the copy error even when the cleanup rm fails too', async () => {
    const state: FakeDaemonState = {
      volumes: new Set(['myproj_platform-data']),
      failCopy: true,
      failRm: true,
    };
    const { dockerFn } = fakeDocker(state);

    await expect(
      copyLegacyConvexDataVolume(PAIR, 'myproj', dockerFn),
    ).rejects.toThrow(/copy .* failed/);
  });

  test('a completed copy makes the detection pass silent (idempotent)', async () => {
    const state: FakeDaemonState = {
      volumes: new Set(['myproj_platform-data']),
      counts: { 'myproj_platform-data': 3, 'myproj_convex-data': 3 },
    };
    const { dockerFn } = fakeDocker(state);

    await copyLegacyConvexDataVolume(PAIR, 'myproj', dockerFn);

    const orphaned = await findOrphanedConvexDataVolumes('myproj', (name) =>
      Promise.resolve(state.volumes.has(name)),
    );
    expect(orphaned).toEqual([]);
  });
});

/** Deps where the layout IS orphaned and every seam is observable. */
function makeOfferDeps(
  overrides: Partial<OfferLegacyMigrationDeps> = {},
): OfferLegacyMigrationDeps {
  return {
    readProjectId: mock(async () => 'myproj'),
    findOrphaned: mock(async () => [PAIR]),
    copyVolume: mock(async () => {}),
    confirmCopy: mock(async () => true),
    canPrompt: mock(() => true),
    ...overrides,
  };
}

describe('offerLegacyConvexDataMigration (P1-8, #1755)', () => {
  test('modern layout: silent no-op', async () => {
    const deps = makeOfferDeps({ findOrphaned: mock(async () => []) });
    const outcome = await offerLegacyConvexDataMigration('/p', {}, deps);
    expect(outcome).toBe('none');
    expect(deps.confirmCopy).not.toHaveBeenCalled();
    expect(deps.copyVolume).not.toHaveBeenCalled();
  });

  test('detection failure is best-effort: never throws, never prompts', async () => {
    const deps = makeOfferDeps({
      findOrphaned: mock(async () => {
        throw new Error('docker daemon unreachable');
      }),
    });
    const outcome = await offerLegacyConvexDataMigration('/p', {}, deps);
    expect(outcome).toBe('none');
    expect(deps.confirmCopy).not.toHaveBeenCalled();
  });

  test('dry-run warns and plans but never prompts or copies', async () => {
    const deps = makeOfferDeps();
    const outcome = await offerLegacyConvexDataMigration(
      '/p',
      { dryRun: true },
      deps,
    );
    expect(outcome).toBe('dry-run');
    expect(deps.confirmCopy).not.toHaveBeenCalled();
    expect(deps.copyVolume).not.toHaveBeenCalled();
  });

  test('accepted: copies every orphaned pair with the project id', async () => {
    const second: OrphanedDataVolume = {
      legacy: 'myproj-dev_platform-data',
      target: 'myproj-dev_convex-data',
    };
    const deps = makeOfferDeps({
      findOrphaned: mock(async () => [PAIR, second]),
    });
    const outcome = await offerLegacyConvexDataMigration('/p', {}, deps);
    expect(outcome).toBe('copied');
    expect(deps.copyVolume).toHaveBeenCalledTimes(2);
    expect(deps.copyVolume).toHaveBeenCalledWith(PAIR, 'myproj');
    expect(deps.copyVolume).toHaveBeenCalledWith(second, 'myproj');
  });

  test('declined: still warned loudly, nothing copied', async () => {
    const deps = makeOfferDeps({ confirmCopy: mock(async () => false) });
    const outcome = await offerLegacyConvexDataMigration('/p', {}, deps);
    expect(outcome).toBe('declined');
    expect(deps.copyVolume).not.toHaveBeenCalled();
  });

  test('non-interactive without --yes: warns, never prompts', async () => {
    const deps = makeOfferDeps({ canPrompt: mock(() => false) });
    const outcome = await offerLegacyConvexDataMigration('/p', {}, deps);
    expect(outcome).toBe('declined');
    expect(deps.confirmCopy).not.toHaveBeenCalled();
    expect(deps.copyVolume).not.toHaveBeenCalled();
  });

  test('a copy failure is reported but does not throw (update proceeds)', async () => {
    const deps = makeOfferDeps({
      copyVolume: mock(async () => {
        throw new Error('cp: I/O error');
      }),
    });
    const outcome = await offerLegacyConvexDataMigration('/p', {}, deps);
    expect(outcome).toBe('failed');
  });
});
