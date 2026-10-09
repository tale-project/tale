// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  createRecorder,
  noRecorder,
  RECORD_MAX_ROWS,
  RECORD_MAX_UNIT_ROWS,
} from './recorder';
import type { NodeRunRecord } from './types';
import { recordBudget, RECORD_RUN_BUDGET } from './value';

const node = { path: 'fetch', item: -1, pass: -1 };

function clocks() {
  let epoch = 1_000;
  let mono = 0;
  return {
    now: () => epoch,
    clock: () => mono,
    advance(ms: number) {
      epoch += ms;
      mono += ms;
    },
  };
}

describe('noRecorder', () => {
  it('keeps nothing', () => {
    noRecorder.unitStarted(node, { nodeId: 'fetch', nodeType: 'transform' });
    noRecorder.unitFinished(node, { status: 'ok', output: 1 });
    expect(noRecorder.enabled).toBe(false);
    expect(noRecorder.snapshot()).toEqual([]);
    expect(noRecorder.drain()).toEqual([]);
  });
});

describe('createRecorder', () => {
  it('records a unit from start to end, with its values and working time', () => {
    const time = clocks();
    const rec = createRecorder(time);
    rec.unitStarted(node, { nodeId: 'fetch', nodeType: 'transform' });
    rec.unitInput(node, { q: 'x' });
    time.advance(40);
    rec.unitFinished(node, { status: 'ok', output: [1, 2] });
    const [record] = rec.snapshot();
    expect(record).toMatchObject({
      key: node,
      nodeId: 'fetch',
      nodeType: 'transform',
      status: 'ok',
      startedAt: 1_000,
      endedAt: 1_040,
      activeMs: 40,
      attempt: 1,
      attempts: [],
      decisions: [],
      waits: [],
    });
    expect(record?.input?.value).toEqual({ q: 'x' });
    expect(record?.output?.value).toEqual([1, 2]);
  });

  it('keeps the latest decision of each kind, stamped with its time', () => {
    const time = clocks();
    const rec = createRecorder(time);
    rec.unitStarted(node, { nodeId: 'fetch', nodeType: 'transform' });
    rec.decision(node, { kind: 'upstream', skipped: ['a'] });
    time.advance(5);
    rec.decision(node, { kind: 'upstream', skipped: ['b'] });
    expect(rec.snapshot()[0]?.decisions).toEqual([
      { kind: 'upstream', skipped: ['b'], at: 1_005 },
    ]);
  });

  it('drains only the rows that changed, with the bytes they newly stored', () => {
    const rec = createRecorder({ ...clocks(), budget: recordBudget() });
    rec.unitStarted(node, { nodeId: 'fetch', nodeType: 'transform' });
    rec.unitInput(node, 'abc');
    const first = rec.drain();
    expect(first).toHaveLength(1);
    expect(first[0]?.bytes).toBe(5);
    expect(rec.drain()).toEqual([]);
    rec.unitFinished(node, { status: 'ok', output: 'de' });
    const second = rec.drain();
    expect(second[0]?.bytes).toBe(4);
    expect(second[0]?.record.status).toBe('ok');
  });

  it('drains only the units it is asked for', () => {
    const rec = createRecorder(clocks());
    const other = { path: 'other', item: -1, pass: -1 };
    rec.unitStarted(node, { nodeId: 'fetch', nodeType: 'llm' });
    rec.unitStarted(other, { nodeId: 'other', nodeType: 'llm' });
    expect(rec.drain([node]).map((w) => w.record.key.path)).toEqual(['fetch']);
    expect(rec.drain().map((w) => w.record.key.path)).toEqual(['other']);
  });

  it('carries again the rows a write did not land, with their bytes', () => {
    const rec = createRecorder({ ...clocks(), budget: recordBudget() });
    rec.unitStarted(node, { nodeId: 'fetch', nodeType: 'llm' });
    rec.unitInput(node, 'abc');
    const lost = rec.drain();
    expect(rec.drain()).toEqual([]);
    rec.restore(lost);
    const again = rec.drain();
    expect(again.map((w) => w.record.key.path)).toEqual(['fetch']);
    expect(again[0]?.bytes).toBe(5);
  });

  it('stops storing values once the run budget is spent', () => {
    const rec = createRecorder({
      ...clocks(),
      budget: recordBudget(RECORD_RUN_BUDGET - 3),
    });
    rec.unitStarted(node, { nodeId: 'fetch', nodeType: 'transform' });
    rec.unitInput(node, 'a');
    rec.unitFinished(node, { status: 'ok', output: 'longer' });
    const [record] = rec.snapshot();
    expect(record?.input?.value).toBe('a');
    expect(record?.output?.value).toBeUndefined();
    expect(record?.output?.summary).toMatchObject({ kind: 'string' });
  });

  it('counts a step’s items on its row, and keeps item rows up to the cap', () => {
    const rec = createRecorder(clocks());
    rec.unitStarted(node, { nodeId: 'fetch', nodeType: 'transform' });
    const total = RECORD_MAX_UNIT_ROWS + 5;
    for (let item = 0; item < total; item++) {
      const key = { path: 'fetch', item, pass: -1 };
      rec.unitStarted(key, { nodeId: 'fetch', nodeType: 'transform' });
      rec.unitFinished(key, {
        status: item === total - 1 ? 'failed' : 'ok',
        output: item,
      });
    }
    rec.unitFinished(node, { status: 'failed' });
    const rows = rec.snapshot();
    const stepRow = rows.find((r) => r.key.item === -1);
    expect(stepRow?.counts).toEqual({
      items: total,
      ok: total - 1,
      failed: 1,
      skipped: 0,
      kept: RECORD_MAX_UNIT_ROWS + 1,
    });
    // The first 200 and the failed one past them.
    expect(rows.filter((r) => r.key.item >= 0)).toHaveLength(
      RECORD_MAX_UNIT_ROWS + 1,
    );
    expect(rows.at(-1)?.key.item).toBe(total - 1);
  });

  it('keeps every step’s row, and item rows up to the run’s cap', () => {
    const rec = createRecorder(clocks());
    const steps = 6;
    for (let n = 0; n < steps; n++) {
      const step = { path: `s${n}`, item: -1, pass: -1 };
      rec.unitStarted(step, { nodeId: step.path, nodeType: 'transform' });
      for (let item = 0; item < RECORD_MAX_UNIT_ROWS; item++) {
        const key = { path: step.path, item, pass: -1 };
        rec.unitStarted(key, { nodeId: step.path, nodeType: 'transform' });
        rec.unitFinished(key, { status: 'ok', output: item });
      }
      rec.unitFinished(step, { status: 'ok' });
    }
    const rows = rec.snapshot();
    const stepRows = rows.filter((r) => r.key.item === -1);
    expect(stepRows.map((r) => r.key.path)).toEqual(
      Array.from({ length: steps }, (_, n) => `s${n}`),
    );
    // Rows stop at the cap; a step's row is kept past it, with its counts.
    expect(rows.length - 1).toBe(RECORD_MAX_ROWS);
    expect(stepRows.at(-1)?.counts).toMatchObject({
      items: RECORD_MAX_UNIT_ROWS,
      ok: RECORD_MAX_UNIT_ROWS,
      kept: 0,
    });
  });

  // REGRESSION: every step of every subautomation walk was kept, so rows
  // multiplied with the items that walked them (100 orders × 100 lines × 5
  // steps), and every read of the record loaded them all.
  it('keeps the steps of subautomation walks only while the run’s rows last', () => {
    const rec = createRecorder(clocks());
    const batch = { path: 'batch', item: -1, pass: -1 };
    rec.unitStarted(batch, { nodeId: 'batch', nodeType: 'forEach' });
    const items = 600;
    for (let item = 0; item < items; item++) {
      for (const child of ['check', 'send']) {
        const key = { path: `batch[${item}:-1]/${child}`, item: -1, pass: -1 };
        rec.unitStarted(key, { nodeId: child, nodeType: 'transform' });
        rec.unitFinished(key, { status: 'ok', output: item });
      }
    }
    rec.unitFinished(batch, { status: 'ok' });
    const rows = rec.snapshot();
    expect(rows.length).toBeLessThanOrEqual(RECORD_MAX_ROWS + 1);
    expect(rows.some((r) => r.key.path === 'batch')).toBe(true);
  });

  it('holds the run’s row cap across turns', () => {
    const rec = createRecorder({ ...clocks(), rowsKept: RECORD_MAX_ROWS });
    const nested = { path: 'batch[0:-1]/send', item: -1, pass: -1 };
    rec.unitStarted(nested, { nodeId: 'send', nodeType: 'transform' });
    rec.unitStarted(node, { nodeId: 'fetch', nodeType: 'transform' });
    expect(rec.snapshot().map((r) => r.key.path)).toEqual(['fetch']);
  });

  it('counts passes on the step row', () => {
    const rec = createRecorder(clocks());
    rec.unitStarted(node, { nodeId: 'fetch', nodeType: 'transform' });
    for (let pass = 0; pass < 3; pass++) {
      const key = { path: 'fetch', item: -1, pass };
      rec.unitStarted(key, { nodeId: 'fetch', nodeType: 'transform' });
      rec.unitFinished(key, { status: 'ok', output: pass });
    }
    expect(rec.snapshot()[0]?.counts?.passes).toBe(3);
  });

  it('opens and closes waits, reopening a re-park of the same kind soon after', () => {
    const time = clocks();
    const rec = createRecorder(time);
    rec.unitStarted(node, { nodeId: 'fetch', nodeType: 'agent' });
    rec.waitOpened(node, { kind: 'room', since: time.now() });
    time.advance(10);
    rec.waitClosed(node);
    time.advance(10);
    rec.waitOpened(node, { kind: 'room', since: time.now() });
    time.advance(10);
    rec.waitClosed(node);
    rec.waitOpened(node, { kind: 'approval', since: time.now(), ref: 'ap1' });
    time.advance(5);
    rec.waitClosed(node, { outcome: 'approved', by: 'member-1' });
    const record = rec.snapshot()[0] as NodeRunRecord;
    expect(record.waits).toEqual([
      { kind: 'room', since: 1_000, until: 1_030 },
      {
        kind: 'approval',
        since: 1_030,
        ref: 'ap1',
        until: 1_035,
        outcome: 'approved',
        by: 'member-1',
      },
    ]);
    // Waiting is not working.
    expect(record.activeMs).toBe(10);
  });

  it('counts a unit an earlier walker left running as an interrupted attempt', () => {
    const time = clocks();
    const open: NodeRunRecord = {
      key: node,
      nodeId: 'fetch',
      nodeType: 'transform',
      status: 'running',
      startedAt: 500,
      activeMs: 7,
      attempt: 1,
      attempts: [],
      decisions: [],
      waits: [],
      meta: {},
    };
    const rec = createRecorder({ ...time, open: [open] });
    rec.unitStarted(node, { nodeId: 'fetch', nodeType: 'transform' });
    rec.unitFinished(node, { status: 'ok', output: 1 });
    const record = rec.snapshot()[0];
    expect(record?.attempt).toBe(2);
    expect(record?.attempts).toEqual([
      { n: 1, startedAt: 500, endedAt: 1_000, outcome: 'interrupted' },
      { n: 2, startedAt: 1_000, endedAt: 1_000, outcome: 'ok' },
    ]);
  });

  it('resumes a loop handed on between items without a new attempt', () => {
    const open: NodeRunRecord = {
      key: node,
      nodeId: 'fetch',
      nodeType: 'transform',
      status: 'running',
      startedAt: 500,
      activeMs: 7,
      attempt: 1,
      attempts: [],
      decisions: [],
      waits: [],
      meta: {},
    };
    const rec = createRecorder({ ...clocks(), open: [open] });
    rec.unitStarted(node, {
      nodeId: 'fetch',
      nodeType: 'transform',
      resuming: true,
    });
    const record = rec.snapshot()[0];
    expect(record?.attempt).toBe(1);
    expect(record?.startedAt).toBe(500);
    expect(record?.activeMs).toBe(7);
  });

  it('closes the wait a resumed unit was parked on', () => {
    const open: NodeRunRecord = {
      key: node,
      nodeId: 'fetch',
      nodeType: 'transform',
      status: 'waiting',
      startedAt: 500,
      activeMs: 3,
      attempt: 1,
      attempts: [],
      decisions: [],
      waits: [{ kind: 'approval', since: 600, ref: 'ap' }],
      meta: {},
    };
    const rec = createRecorder({ ...clocks(), open: [open] });
    rec.unitStarted(node, { nodeId: 'fetch', nodeType: 'transform' });
    const record = rec.snapshot()[0];
    expect(record?.status).toBe('running');
    expect(record?.attempt).toBe(1);
    expect(record?.waits).toEqual([
      { kind: 'approval', since: 600, ref: 'ap', until: 1_000 },
    ]);
  });

  it('keeps the rendered spans of each field', () => {
    const rec = createRecorder(clocks());
    rec.unitStarted(node, { nodeId: 'fetch', nodeType: 'llm' });
    rec.meta(node, {
      rendered: { '/nodes/0/prompt': [{ unit: [3, 10], out: [0, 4] }] },
    });
    rec.meta(node, {
      rendered: { '/nodes/0/system': [{ unit: [0, 5], out: [2, 3] }] },
    });
    expect(Object.keys(rec.snapshot()[0]?.meta.rendered ?? {})).toEqual([
      '/nodes/0/prompt',
      '/nodes/0/system',
    ]);
  });

  it('merges metadata', () => {
    const rec = createRecorder(clocks());
    rec.unitStarted(node, { nodeId: 'fetch', nodeType: 'llm' });
    rec.meta(node, { model: 'm1' });
    rec.meta(node, { docRef: 'child@2' });
    expect(rec.snapshot()[0]?.meta).toEqual({ model: 'm1', docRef: 'child@2' });
  });
});
