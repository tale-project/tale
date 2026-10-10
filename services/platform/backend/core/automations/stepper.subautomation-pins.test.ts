import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Automation } from '../../../lib/engine/core/types';
import { fakeStepperWorld, type FakeSaved } from './stepper.test-helpers.ts';
import { stepRunImpl } from './stepper.ts';

const RUN = { organizationId: 'org-1', runId: 'run-1' } as never;

function returning(name: string, value: string): Automation {
  return {
    version: 1,
    name,
    nodes: [{ id: 'mark', type: 'transform', code: `return "${value}";` }],
    output: '{{ nodes.mark.output }}',
  } as Automation;
}

/** A part of the report that formats itself through a second automation. */
function reportPart(value: string): Automation {
  return {
    version: 1,
    name: 'report-part',
    nodes: [
      { id: 'mark', type: 'transform', code: `return "${value}";` },
      { id: 'inner', type: 'subautomation', automation: 'format' },
    ],
    output: {
      part: '{{ nodes.mark.output }}',
      format: '{{ nodes.inner.output }}',
    },
  } as Automation;
}

function report(reference: string): Automation {
  return {
    version: 1,
    name: 'weekly-report',
    nodes: [
      {
        id: 'batch',
        type: 'subautomation',
        automation: reference,
        forEach: '{{ input.weeks }}',
      },
    ],
    output: '{{ nodes.batch.output }}',
  } as Automation;
}

/** The two saved automations a report reaches, each with two versions. */
function saved(): { part: FakeSaved; format: FakeSaved } {
  return {
    part: {
      versions: { 1: reportPart('v1'), 2: reportPart('v2') },
      deployed: 1,
    },
    format: {
      versions: { 5: returning('format', 'f5'), 6: returning('format', 'f6') },
      deployed: 5,
    },
  };
}

// A budget of zero hands the run on after every forEach item, so each item
// of the report is its own turn.
let budget: string | undefined;
beforeEach(() => {
  budget = process.env.TALE_AUTOMATION_STEP_BUDGET_MS;
  process.env.TALE_AUTOMATION_STEP_BUDGET_MS = '0';
});
afterEach(() => {
  if (budget === undefined) delete process.env.TALE_AUTOMATION_STEP_BUDGET_MS;
  else process.env.TALE_AUTOMATION_STEP_BUDGET_MS = budget;
});

describe('the versions a subautomation node walks', () => {
  it('stay the ones it started with when a newer one is deployed between two turns', async () => {
    const { part, format } = saved();
    const world = fakeStepperWorld({
      document: report('report-part'),
      input: { weeks: [40, 41] },
      saved: { 'report-part': part, format },
    });

    await expect(stepRunImpl(world.ctx, RUN)).resolves.toEqual({
      status: 'running',
    });
    // Fixed — the chain included — and saved before the first item ran.
    expect(world.progress[0]).toMatchObject({
      cursor: {
        node: 'batch',
        index: 0,
        outs: [],
        pins: { batch: 1, 'batch/inner': 5 },
      },
    });
    expect(world.progress[0]?.nodeId).toBeUndefined();

    // Someone deploys new versions of both while the run waits for its
    // next turn.
    part.deployed = 2;
    format.deployed = 6;
    world.lookups.length = 0;

    await expect(stepRunImpl(world.ctx, RUN)).resolves.toEqual({
      status: 'success',
    });
    expect(world.finished[0]?.output).toEqual([
      { part: 'v1', format: 'f5' },
      { part: 'v1', format: 'f5' },
    ]);
    expect(world.lookups).toEqual([
      expect.objectContaining({ name: 'report-part', version: 1 }),
      expect.objectContaining({ name: 'format', version: 5 }),
    ]);
  });

  it('keep an explicit version as written', async () => {
    const { part, format } = saved();
    const world = fakeStepperWorld({
      document: report('report-part@2'),
      input: { weeks: [40] },
      saved: { 'report-part': part, format },
    });

    await expect(stepRunImpl(world.ctx, RUN)).resolves.toEqual({
      status: 'success',
    });
    expect(world.progress[0]).toMatchObject({
      cursor: { pins: { batch: 2, 'batch/inner': 5 } },
    });
    expect(world.finished[0]?.output).toEqual([{ part: 'v2', format: 'f5' }]);
  });
});
