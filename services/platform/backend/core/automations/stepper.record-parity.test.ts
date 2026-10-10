// @vitest-environment node

/**
 * The run record is the same however a run is carried out: for seeded
 * documents, the in-process executor and the durable stepper record the same
 * units with the same statuses, skips, decisions, failures, counts and
 * values. Both executors decide through one module; this holds them to it.
 *
 * Each document is a random DAG of transforms over a seeded generator (so a
 * failure reproduces): data references, `when` conditions driven by the run
 * input, `elseOf` branches, steps that fail and go on, `forEach` lists and
 * `repeatUntil` passes. Times, working time and attempts differ by nature and
 * are left out; so is metadata.
 */

import { seeded } from '@tale/ui/data/random-json';
import { beforeAll, describe, expect, it } from 'vitest';

import { execute } from '../../../lib/engine/core/execute';
import { createRecorder } from '../../../lib/engine/core/record/recorder';
import type { NodeRunRecord } from '../../../lib/engine/core/record/types';
import { setCodeRunner } from '../../../lib/engine/core/runner';
import type { Automation, NodeDef } from '../../../lib/engine/core/types';
import { nodeVmRunner } from '../../../lib/engine/runners/node-vm';
import { fakeStepperWorld } from './stepper.test-helpers.ts';
import { stepRunImpl } from './stepper.ts';

const DOCUMENTS = 150;
const SEED = 20261009;
const RUN = { organizationId: 'org-1', runId: 'run-1' } as never;

beforeAll(() => {
  setCodeRunner(nodeVmRunner());
});

function pick<T>(random: () => number, items: readonly T[]): T | undefined {
  return items[Math.floor(random() * items.length)];
}

function generate(random: () => number, index: number): Automation {
  const count = 2 + Math.floor(random() * 5);
  const nodes: NodeDef[] = [];
  for (let i = 0; i < count; i++) {
    const id = `n${i}`;
    const earlier = nodes.map((n) => n.id);
    const reads = earlier.filter(() => random() < 0.35);
    const input: Record<string, unknown> = { n: '{{ input.n }}' };
    for (const ref of reads) input[`r_${ref}`] = `{{ nodes.${ref}.output }}`;
    const node: NodeDef = {
      id,
      type: 'transform',
      input,
      code: [
        "if (input.fail === true) throw new Error('planned failure');",
        `return { at: ${i}, n: input.n, item: typeof item === 'undefined' ? null : item };`,
      ].join('\n'),
    };
    if (random() < 0.25) {
      node.onError = 'continue';
      input.fail = `{{ input.f_${id} }}`;
    }
    if (random() < 0.35) {
      const control = random() < 0.4 ? pick(random, earlier) : undefined;
      node.when =
        control === undefined
          ? `input.w_${id}`
          : `(nodes.${control}.output, input.w_${id})`;
    }
    if (earlier.length > 0 && random() < 0.2) {
      const withWhen = nodes.filter((n) => n.when !== undefined);
      node.elseOf = pick(random, withWhen)?.id ?? pick(random, earlier);
    }
    const shape = random();
    if (shape < 0.2) node.forEach = '{{ input.list }}';
    else if (shape < 0.3) {
      node.repeatUntil = 'output.n >= 0';
      node.maxRepeats = 2;
    }
    nodes.push(node);
  }
  return {
    version: 1,
    name: `record-parity-${index}`,
    nodes,
    output: { last: `{{ nodes.n${count - 1}.output }}` },
  };
}

function inputFor(
  random: () => number,
  doc: Automation,
): Record<string, unknown> {
  const input: Record<string, unknown> = {
    n: Math.floor(random() * 10),
    list: Array.from({ length: Math.floor(random() * 3) }, (_, i) => i),
  };
  for (const node of doc.nodes) {
    input[`w_${node.id}`] = random() < 0.5;
    input[`f_${node.id}`] = random() < 0.3;
  }
  return input;
}

/** What both executors must agree on, by unit. */
function normalized(
  records: readonly NodeRunRecord[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const r of records) {
    if (r.key.path === '__start') continue;
    out[`${r.key.path}|${r.key.item}|${r.key.pass}`] = {
      status: r.status,
      skip: r.skip ?? null,
      decisions: r.decisions.map((d) => {
        switch (d.kind) {
          case 'when':
            return { kind: d.kind, result: d.result, value: d.value };
          case 'repeatUntil':
            return {
              kind: d.kind,
              pass: d.pass,
              result: d.result,
              capped: d.capped,
            };
          case 'forEach':
            return { kind: d.kind, count: d.count, value: d.value };
          default: {
            const { at: _at, ...rest } = d;
            return rest;
          }
        }
      }),
      failure:
        r.failure === undefined
          ? null
          : { reason: r.failure.reason, at: r.failure.at ?? null },
      counts: r.counts ?? null,
      input: r.input?.hash ?? null,
      output: r.output?.hash ?? null,
    };
  }
  return out;
}

async function durable(
  doc: Automation,
  input: unknown,
): Promise<NodeRunRecord[]> {
  const world = fakeStepperWorld({ document: doc, mode: 'mock', input });
  for (let turn = 0; turn < 20 && world.finished.length === 0; turn++) {
    await stepRunImpl(world.ctx, RUN);
    world.run.status = 'running';
  }
  expect(world.finished, 'the durable run finished').toHaveLength(1);
  return [...world.nodeRuns.values()];
}

describe('the run record is the same in both executors', () => {
  it(`for ${DOCUMENTS} seeded documents`, async () => {
    const random = seeded(SEED);
    for (let index = 0; index < DOCUMENTS; index++) {
      const doc = generate(random, index);
      const input = inputFor(random, doc);
      const inProcess = await execute(doc, {
        input,
        recorder: createRecorder({ now: () => 0 }),
      });
      const stepped = await durable(doc, input);
      expect(
        normalized(stepped),
        `${JSON.stringify(doc)}\n${JSON.stringify(input)}`,
      ).toEqual(normalized(inProcess.record ?? []));
    }
  }, 120_000);
});
