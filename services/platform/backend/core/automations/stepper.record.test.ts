// @vitest-environment node

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { NodeRunRecord } from '../../../lib/engine/core/record/types';
import { setCodeRunner } from '../../../lib/engine/core/runner';
import type { Automation } from '../../../lib/engine/core/types';
import { nodeVmRunner } from '../../../lib/engine/runners/node-vm';
import { fakeStepperWorld, type FakeWorld } from './stepper.test-helpers.ts';
import { setAutomationApprovalGate, stepRunImpl } from './stepper.ts';

const RUN = { organizationId: 'org-1', runId: 'run-1' } as never;

beforeAll(() => {
  setCodeRunner(nodeVmRunner());
});

afterEach(() => {
  setAutomationApprovalGate(null);
});

function row(
  world: FakeWorld,
  path: string,
  item = -1,
  pass = -1,
): NodeRunRecord | undefined {
  return world.nodeRuns.get(`${path}\u0000${item}\u0000${pass}`);
}

/** Step the run turn by turn until it finishes. */
async function walk(world: FakeWorld, turns = 10): Promise<void> {
  for (let turn = 0; turn < turns && world.finished.length === 0; turn++) {
    await stepRunImpl(world.ctx, RUN);
    if (world.run.status === 'waiting' || world.run.status === 'queued') {
      world.run.status = 'running';
    }
  }
}

const COUNT: Automation = {
  version: 1,
  name: 'count-files',
  nodes: [
    { id: 'list', type: 'webdav.list', input: { path: '{{ input.path }}' } },
    {
      id: 'count',
      type: 'transform',
      input: { files: '{{ nodes.list.output.files }}' },
      code: 'return input.files.length;',
    },
  ],
  output: '{{ nodes.count.output }}',
};

describe('the durable record of a run', () => {
  it('rides each progress write, and ends with the run output [AUTO-R38]', async () => {
    const world = fakeStepperWorld({
      document: COUNT,
      mode: 'mock',
      input: { path: '/inbox' },
      connector: async () => ({
        status: 'ok',
        output: { files: ['a', 'b'] },
        effects: 'read',
      }),
    });
    await walk(world);
    expect(world.finished[0]?.status).toBe('success');
    // Each step's row went with the commit of its checkpoint.
    expect(
      world.progress.map((write) =>
        (write.nodeRuns as Array<{ record: NodeRunRecord }> | undefined)?.map(
          (r) => r.record.key.path,
        ),
      ),
    ).toEqual([['list'], ['count']]);
    expect(row(world, 'list')).toMatchObject({
      status: 'ok',
      input: { value: { path: '/inbox' } },
      output: { value: { files: ['a', 'b'] } },
      meta: { connector: 'webdav', action: 'webdav.list', effect: 'read' },
    });
    expect(row(world, 'count')?.output?.value).toBe(2);
    expect(row(world, '__end')).toMatchObject({
      status: 'ok',
      output: { value: 2 },
    });
    expect(world.recordBytes).toBeGreaterThan(0);
  });

  it('writes a long step’s start with its input before it commits', async () => {
    const world = fakeStepperWorld({
      document: COUNT,
      mode: 'mock',
      input: { path: '/inbox' },
      connector: async () => ({
        status: 'ok',
        output: { files: [] },
        effects: 'read',
      }),
    });
    await walk(world);
    expect(world.startedWrites).toHaveLength(1);
    const rows = (world.startedWrites[0]?.rows ?? []) as Array<{
      record: NodeRunRecord;
    }>;
    const [started] = rows;
    expect(started?.record).toMatchObject({
      key: { path: 'list', item: -1, pass: -1 },
      status: 'running',
      input: { value: { path: '/inbox' } },
    });
  });

  it('records why a step failed, at the step', async () => {
    const world = fakeStepperWorld({
      document: {
        version: 1,
        name: 'broken',
        nodes: [
          {
            id: 'read',
            type: 'transform',
            input: { title: '{{ input.issue.title }}' },
            code: 'return input.title;',
          },
        ],
      },
      mode: 'mock',
      input: {},
    });
    await walk(world);
    expect(world.finished[0]?.status).toBe('failed');
    expect(row(world, 'read')).toMatchObject({
      status: 'failed',
      failure: {
        code: 'node_error',
        reason: 'EXPR_READ_MISSING',
        params: { key: 'title', chain: 'input.issue' },
        at: { pointer: '/nodes/0/input/title' },
      },
    });
  });

  it('records a wait for approval, and closes it when the run comes back', async () => {
    let asks = 0;
    setAutomationApprovalGate({
      check: async () =>
        ++asks === 1
          ? { status: 'required', approvalId: 'ap-1' }
          : { status: 'allowed' },
    });
    const world = fakeStepperWorld({
      document: {
        version: 1,
        name: 'save-report',
        nodes: [
          {
            id: 'save',
            type: 'webdav.write',
            input: { path: '/r.txt', content: 'x' },
          },
        ],
      },
      mode: 'live',
      input: {},
    });
    await stepRunImpl(world.ctx, RUN);
    expect(row(world, 'save')).toMatchObject({
      status: 'waiting',
      waits: [{ kind: 'approval', ref: 'ap-1' }],
    });
    world.run.status = 'running';
    await walk(world);
    const save = row(world, 'save');
    expect(save?.status).toBe('ok');
    expect(save?.attempt).toBe(1);
    expect(save?.waits).toHaveLength(1);
    expect(save?.waits[0]?.until).toBeTypeOf('number');
  });

  it('counts a step an earlier walker left running as interrupted [AUTO-R39]', async () => {
    const world = fakeStepperWorld({
      document: COUNT,
      mode: 'mock',
      input: { path: '/inbox' },
      connector: async () => ({
        status: 'ok',
        output: { files: [] },
        effects: 'read',
      }),
    });
    world.nodeRuns.set('list\u0000-1\u0000-1', {
      key: { path: 'list', item: -1, pass: -1 },
      nodeId: 'list',
      nodeType: 'webdav.list',
      status: 'running',
      startedAt: 1,
      activeMs: 5,
      attempt: 1,
      attempts: [],
      decisions: [],
      waits: [],
      meta: {},
    });
    await walk(world);
    expect(row(world, 'list')).toMatchObject({
      status: 'ok',
      attempt: 2,
      attempts: [
        { n: 1, outcome: 'interrupted' },
        { n: 2, outcome: 'ok' },
      ],
    });
  });

  it('records each item of a forEach step, and its counts', async () => {
    const world = fakeStepperWorld({
      document: {
        version: 1,
        name: 'each',
        nodes: [
          {
            id: 'double',
            type: 'transform',
            forEach: '{{ input.list }}',
            input: {},
            code: 'return item * 2;',
          },
        ],
      },
      mode: 'mock',
      input: { list: [1, 2, 3] },
    });
    await walk(world);
    expect(row(world, 'double')).toMatchObject({
      status: 'ok',
      counts: { items: 3, ok: 3, failed: 0, skipped: 0, kept: 3 },
      decisions: [{ kind: 'forEach', count: 3 }],
    });
    expect(row(world, 'double', 2)?.output?.value).toBe(6);
  });
});
