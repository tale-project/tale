import { afterEach, describe, expect, mock, test } from 'bun:test';

import type { ApplyOutcome, Migration, MigrationContext } from './types';

// --- Mocks ---

const recordAppliedMock = mock();

mock.module('./state', () => ({
  recordApplied: recordAppliedMock,
}));

mock.module('../../utils/logger', () => ({
  blank: mock(),
  header: mock(),
  info: mock(),
  notice: mock(),
  step: mock(),
  success: mock(),
  warn: mock(),
  debug: mock(),
  error: mock(),
}));

mock.module('../../utils/confirm', () => ({
  confirm: mock(() => Promise.resolve(true)),
}));

// --- Helpers ---

const CTX: MigrationContext = {
  projectId: 'test-project',
  projectDir: '/tmp/test-project',
};

function makeMigration(
  id: string,
  opts: {
    detect?: boolean;
    apply?: ApplyOutcome;
    stops?: string[];
    detectFn?: () => Promise<boolean>;
  } = {},
): Migration {
  return {
    id,
    introducedIn: '0.0.1',
    description: `Migration ${id}`,
    detect: opts.detectFn ?? mock(() => Promise.resolve(opts.detect ?? false)),
    requiredStops: mock(() => Promise.resolve(opts.stops ?? [])),
    apply: mock(() => Promise.resolve(opts.apply ?? 'applied')),
  };
}

// --- Import after mocks ---

const { runPendingMigrations, planPendingMigrations } =
  await import('./runner');

afterEach(() => {
  recordAppliedMock.mockReset();
});

// --- Tests ---

describe('runPendingMigrations', () => {
  test('returns proceed=true with no applied when nothing is pending', async () => {
    const m = makeMigration('a', { detect: false });
    const result = await runPendingMigrations([m], CTX, {
      context: 'deploy',
      assumeYes: true,
    });

    expect(result).toEqual({ proceed: true, applied: [], declined: false });
    expect(m.detect).toHaveBeenCalledWith(CTX);
    expect(m.apply).not.toHaveBeenCalled();
  });

  test('applies a new pending migration', async () => {
    const m = makeMigration('a', { detect: true, apply: 'applied' });
    const result = await runPendingMigrations([m], CTX, {
      context: 'deploy',
      assumeYes: true,
    });

    expect(result.proceed).toBe(true);
    expect(result.applied).toEqual(['a']);
    expect(m.apply).toHaveBeenCalledWith(CTX, { dryRun: false });
    expect(recordAppliedMock).toHaveBeenCalledTimes(1);
    expect(recordAppliedMock.mock.calls[0][1]).toMatchObject({ id: 'a' });
  });

  test('re-detects and re-applies a drifted migration (detect returns true even if previously recorded)', async () => {
    // Simulate a migration whose end-state has drifted: detect() returns true
    // even though recordApplied would be a no-op (already recorded).
    // The key assertion: detect() IS called, apply() IS called.
    const m = makeMigration('split-convex', {
      detect: true,
      apply: 'applied',
    });

    const result = await runPendingMigrations([m], CTX, {
      context: 'deploy',
      assumeYes: true,
    });

    expect(result.proceed).toBe(true);
    expect(result.applied).toEqual(['split-convex']);
    expect(m.detect).toHaveBeenCalledTimes(1);
    expect(m.apply).toHaveBeenCalledTimes(1);
  });

  test('skips migrations whose detect() returns false', async () => {
    const satisfied = makeMigration('done', { detect: false });
    const pending = makeMigration('todo', { detect: true, apply: 'applied' });

    const result = await runPendingMigrations([satisfied, pending], CTX, {
      context: 'deploy',
      assumeYes: true,
    });

    expect(result.applied).toEqual(['todo']);
    expect(satisfied.detect).toHaveBeenCalled();
    expect(satisfied.apply).not.toHaveBeenCalled();
  });

  test('preserves registry order for mixed pending migrations', async () => {
    const a = makeMigration('a', { detect: true, apply: 'applied' });
    const b = makeMigration('b', { detect: false });
    const c = makeMigration('c', { detect: true, apply: 'applied' });

    const result = await runPendingMigrations([a, b, c], CTX, {
      context: 'deploy',
      assumeYes: true,
    });

    expect(result.applied).toEqual(['a', 'c']);
    // Verify order: a applied before c
    const aCallOrder = (a.apply as ReturnType<typeof mock>).mock
      .invocationCallOrder[0];
    const cCallOrder = (c.apply as ReturnType<typeof mock>).mock
      .invocationCallOrder[0];
    expect(aCallOrder).toBeLessThan(cCallOrder);
  });

  test('propagates detect() errors with context', async () => {
    const m = makeMigration('bad', {
      detectFn: () => Promise.reject(new Error('docker not found')),
    });

    await expect(
      runPendingMigrations([m], CTX, {
        context: 'deploy',
        assumeYes: true,
      }),
    ).rejects.toThrow('migration bad: detect() failed: docker not found');
  });

  test('collects requiredStops from all pending migrations', async () => {
    const a = makeMigration('a', {
      detect: true,
      apply: 'applied',
      stops: ['container-1'],
    });
    const b = makeMigration('b', {
      detect: true,
      apply: 'applied',
      stops: ['container-2', 'container-1'],
    });

    const stopsReceived: string[][] = [];
    const performStops = mock((s: string[]) => {
      stopsReceived.push(s);
      return Promise.resolve();
    });

    await runPendingMigrations([a, b], CTX, {
      context: 'deploy',
      assumeYes: true,
      performStops,
    });

    expect(performStops).toHaveBeenCalledTimes(1);
    expect(stopsReceived[0]).toContain('container-1');
    expect(stopsReceived[0]).toContain('container-2');
    expect(stopsReceived[0]).toHaveLength(2); // deduplicated
  });

  test('handles noop outcome from apply()', async () => {
    const m = makeMigration('already-ok', { detect: true, apply: 'noop' });

    const result = await runPendingMigrations([m], CTX, {
      context: 'deploy',
      assumeYes: true,
    });

    expect(result.applied).toEqual(['already-ok']);
    expect(recordAppliedMock).toHaveBeenCalledTimes(1);
  });

  test('dry-run prints plan but does not apply', async () => {
    const m = makeMigration('a', { detect: true });

    const result = await runPendingMigrations([m], CTX, {
      context: 'deploy',
      assumeYes: true,
      dryRun: true,
    });

    expect(result.applied).toEqual([]);
    expect(m.apply).not.toHaveBeenCalled();
    expect(recordAppliedMock).not.toHaveBeenCalled();
  });
});

describe('planPendingMigrations', () => {
  test('returns empty array when nothing is pending', async () => {
    const m = makeMigration('a', { detect: false });
    const result = await planPendingMigrations([m], CTX);
    expect(result).toEqual([]);
  });

  test('returns pending migrations without applying', async () => {
    const m = makeMigration('a', { detect: true });
    const result = await planPendingMigrations([m], CTX);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a');
    expect(m.apply).not.toHaveBeenCalled();
  });
});
