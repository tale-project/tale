import { expect, test } from 'bun:test';

import {
  collectDialogAttempt,
  dialogPlan,
  runDialogPlan,
} from './browser/dialog-plan.ts';
import {
  assertDialogSources,
  dialogAdmission,
  dialogProductPair,
} from './browser/dialog-sources.mjs';
import {
  benchmarkMode,
  measurementPlan,
  sharedBudgetMs,
} from './browser/mode.mjs';

test('exclusive dialog mode retains four immutable serial ABBA targets and its short budget', async () => {
  expect(dialogPlan.map(({ arm }) => arm)).toEqual([
    'baseline',
    'candidate',
    'candidate',
    'baseline',
  ]);
  expect(new Set(dialogPlan.map(({ targetIndex }) => targetIndex)).size).toBe(
    4,
  );
  expect(Object.isFrozen(dialogPlan)).toBe(true);
  expect(dialogPlan.every(Object.isFrozen)).toBe(true);
  const seen: number[] = [];
  let active = false;
  await runDialogPlan({
    before: async () => {
      expect(active).toBe(false);
    },
    run: async ({ index }) => {
      active = true;
      await Promise.resolve();
      seen.push(index);
      active = false;
    },
    failure: async () => {
      throw new Error('Unexpected failure');
    },
  });
  expect(seen).toEqual([0, 1, 2, 3]);
  expect(measurementPlan('dialog')).toEqual({
    seedTasks: true,
    script: 'dialog-profile.ts',
    timeoutMs: 300_000,
  });
  expect(sharedBudgetMs('dialog')).toBe(32 * 60_000);
  for (const other of [
    'benchmark:task-board',
    'benchmark:task-board-acceptance',
    'benchmark:browser-protocol',
  ])
    expect(() =>
      benchmarkMode({
        BENCH_EVENT_NAME: 'pull_request',
        BENCH_LABELS: JSON.stringify(['benchmark:task-dialog-profile', other]),
      }),
    ).toThrow('Exactly one');
  expect(
    benchmarkMode({
      BENCH_EVENT_NAME: 'workflow_dispatch',
      BENCH_REQUESTED_MODE: 'dialog',
    }),
  ).toBe('dialog');
});

test('a failed primary attempt is retained once, with no replacement or later attempt', async () => {
  const seen: number[] = [];
  const failures: number[] = [];
  await expect(
    runDialogPlan({
      before: async () => {},
      run: async ({ index }) => {
        seen.push(index);
        if (index === 1) throw new Error('trace failed');
      },
      failure: async ({ index }) => {
        failures.push(index);
      },
    }),
  ).rejects.toThrow('trace failed');
  expect(seen).toEqual([0, 1]);
  expect(failures).toEqual([1]);
});

test('evidence-write failure retains the original attempt failure', async () => {
  const original = new Error('original');
  const write = new Error('write');
  let caught: unknown;
  try {
    await runDialogPlan({
      before: async () => {
        throw original;
      },
      run: async () => {},
      failure: async () => {
        throw write;
      },
    });
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AggregateError);
  expect((caught as AggregateError).errors).toEqual([original, write]);
});

function control() {
  const order: string[] = [];
  return {
    order,
    io: {
      load: async () => {
        order.push('load');
        return { boardReady: true as const, taskDetailReads: 0 };
      },
      prepare: async () => {
        order.push('prepare');
      },
      collect: async () => {
        order.push('collect');
        return 'raw retained';
      },
      checkpoint: async () => {
        order.push('checkpoint');
      },
      inspect: async (state: 'open' | 'closed') => {
        order.push(`inspect-${state}`);
        return state;
      },
      close: async () => {
        order.push('close');
      },
    },
  };
}

test('readiness and GC precede tracing; every structural inspection follows finalized raw retention', async () => {
  const f = control();
  expect(await collectDialogAttempt(f.io)).toEqual({
    primary: 'raw retained',
    postCollection: { open: 'open', closed: 'closed' },
  });
  expect(f.order).toEqual([
    'load',
    'prepare',
    'collect',
    'checkpoint',
    'inspect-open',
    'close',
    'inspect-closed',
  ]);
});

test('false board or detail prewarm blocks profiler start', async () => {
  for (const loaded of [
    { boardReady: false, taskDetailReads: 0 },
    { boardReady: true, taskDetailReads: 1 },
  ]) {
    const f = control();
    await expect(
      collectDialogAttempt({
        ...f.io,
        load: async () =>
          loaded as { boardReady: true; taskDetailReads: number },
      }),
    ).rejects.toThrow();
    expect(f.order).toEqual([]);
  }
});

test('a trace/finalization or checkpoint failure never starts post-collection inspection', async () => {
  for (const step of ['collect', 'checkpoint'] as const) {
    const f = control();
    await expect(
      collectDialogAttempt({
        ...f.io,
        [step]: async () => {
          throw new Error(step);
        },
      }),
    ).rejects.toThrow(step);
    expect(f.order.some((name) => name.startsWith('inspect'))).toBe(false);
    expect(f.order).not.toContain('close');
  }
});

test('dialog source guard keeps exact failed-campaign product/dependency bytes and baseline', () => {
  const allowed = [
    'scripts/performance/browser/dialog-profile.ts',
    'scripts/performance/browser-dialog-plan.test.ts',
    '.github/workflows/browser-performance.yml',
    'scripts/performance/README.md',
    'services/platform/tests/manual/reference/automation.md',
  ];
  expect(assertDialogSources(dialogProductPair.baseline, allowed)).toEqual({
    ...dialogProductPair,
    harnessOnlyChanges: allowed,
  });
  expect(() =>
    assertDialogSources('d29a3c8fe78cdba54d247fe82ea5195f702c0651', []),
  ).toThrow('baseline drifted');
  for (const path of [
    'bun.lock',
    'package.json',
    'packages/ui/src/button.tsx',
    'services/platform/app/features/tasks/components/task-modal.tsx',
    'services/platform/backend/app.ts',
    'scripts/performance/browser/../../foreign.ts',
  ])
    expect(() =>
      assertDialogSources(dialogProductPair.baseline, [path]),
    ).toThrow('product source drift');
});

test('only explicit dialog admission selects its independent pair and preserves the actual PR base', () => {
  const eventBase = 'ffa15'.padEnd(40, 'a');
  expect(dialogAdmission('pull_request', eventBase)).toMatchObject({
    eventName: 'pull_request',
    eventBaseline: eventBase,
    baseline: dialogProductPair.baseline,
    productCandidate: dialogProductPair.candidate,
  });
  expect(
    dialogAdmission('workflow_dispatch', dialogProductPair.baseline)
      .eventBaseline,
  ).toBe(dialogProductPair.baseline);
  expect(() => dialogAdmission('workflow_dispatch', eventBase)).toThrow(
    'explicitly request',
  );
  expect(() => dialogAdmission('pull_request', 'main')).toThrow('Malformed');
  expect(() => dialogAdmission('pull_request_target', eventBase)).toThrow(
    'Unknown',
  );
});
