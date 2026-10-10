/**
 * What the automation engine costs today, case by case — the baseline a
 * faster engine is measured against, and a note, not a gate: resolving one
 * item's templates beside a large earlier output, the code runner warm and
 * under load, and whole documents through `execute()`. Cases this engine
 * cannot run yet (steps at the same time, a pool of runners, a cached plan)
 * are listed as `bench.todo`. Run it with
 * `bunx vitest bench --project server lib/engine/core/execute/perf.bench.ts`.
 */

import { bench, describe } from 'vitest';

import { nodeVmRunner } from '../../runners/node-vm';
import { createRecorder } from '../record/recorder';
import { setCodeRunner } from '../runner';
import { evalTemplates } from '../template';
import type { Automation, NodeDef } from '../types';
import { execute } from './index';
import { freezeScopes, makeScope } from './scope';

const runner = nodeVmRunner();
setCodeRunner(runner);
// Production's scopes, not the suites' frozen copies.
freezeScopes(false);

const LIMITS = { timeoutMs: 5000 };

/** An earlier step's output of about `mb` megabytes: rows of ~80 bytes. */
function rowsOf(mb: number): { rows: { id: number; name: string }[] } {
  return {
    rows: Array.from({ length: mb * 10_000 }, (_, id) => ({
      id,
      name: 'x'.repeat(80),
    })),
  };
}

/** One item's prompt and input as the triage pack writes them: five
 * template units. */
const ITEM_MAPPING = {
  prompt:
    'Issue #{{ item.number }}: {{ item.title }}\n\nLabels: {{ item.labels }}\n\nBody:\n{{ item.body }}',
  owner: '{{ input.owner }}',
};
const ITEM = {
  number: 7,
  title: 'Issue 7',
  labels: ['bug'],
  body: 'b'.repeat(2000),
};

describe("one forEach item's templates (5 units)", () => {
  for (const mb of [0, 1, 5]) {
    const outputs = {
      big: { output: rowsOf(mb) },
      issues: { output: { issues: [ITEM] } },
    };
    bench(
      `beside ${mb} MB of an unrelated earlier output`,
      async () => {
        await evalTemplates(
          ITEM_MAPPING,
          makeScope({ owner: 'tale' }, outputs, { item: ITEM, index: 0 }),
        );
      },
      { iterations: 20 },
    );
  }
  const five = { big: { output: rowsOf(5) } };
  bench(
    'one path into a 5 MB output',
    async () => {
      await evalTemplates(
        '{{ nodes.big.output.rows[3].name }}',
        makeScope({}, five),
      );
    },
    { iterations: 20 },
  );
  bench(
    'one unit the runner evaluates, beside 5 MB of an unrelated earlier output',
    async () => {
      await evalTemplates(
        '{{ input.items.length + 1 }}',
        makeScope({ items: [1, 2, 3] }, five),
      );
    },
    { iterations: 50 },
  );
});

/** A transform body that keeps one core busy for about 20 ms. */
const CPU_BODY =
  'let x = 0; for (let i = 0; i < 4e6; i++) x = (x + i * 7) % 1000003; return { x, n: input.n };';

describe('the code runner', () => {
  bench('a warm small expression', async () => {
    await runner.evalExpr(
      'input.a + 1',
      { input: { a: 1 }, nodes: {} },
      LIMITS,
    );
  });
  bench(
    '16 CPU-bound transform bodies at once, one runner',
    async () => {
      await Promise.all(
        Array.from({ length: 16 }, (_, n) =>
          runner.runBody(CPU_BODY, { input: { n }, nodes: {} }, LIMITS),
        ),
      );
    },
    { iterations: 3 },
  );
  bench.todo('16 CPU-bound transform bodies at once, a pool of 2 and of 4');
});

/** Forty transforms, each returning about 9 KB, each reading the previous
 * one (`chain`) or only the input (`fan`). */
function fortyTransforms(shape: 'chain' | 'fan'): Automation {
  const nodes: NodeDef[] = Array.from({ length: 40 }, (_, i) => ({
    id: `n${i}`,
    type: 'transform',
    input: {
      prev:
        shape === 'fan' || i === 0
          ? '{{ input.x }}'
          : `{{ nodes.n${i - 1}.output.v }}`,
      label: 'step {{ input.x }}',
    },
    code: 'return { v: input.prev + 1, rows: Array.from({ length: 200 }, (_, k) => ({ k, s: "x".repeat(40) })) };',
  }));
  return {
    version: 1,
    name: `forty-${shape}`,
    nodes,
    output: '{{ nodes.n39.output.v }}',
  };
}

describe('execute(), 40 transforms of about 9 KB output each', () => {
  for (const shape of ['chain', 'fan'] as const) {
    const doc = fortyTransforms(shape);
    bench(
      shape === 'chain' ? 'each reading the one before' : 'all independent',
      async () => {
        const result = await execute(doc, { input: { x: 1 } });
        if (result.status !== 'success') {
          throw new Error(`the ${shape} run ended ${result.status}`);
        }
      },
      { iterations: 5 },
    );
  }
  for (const shape of ['chain', 'fan'] as const) {
    const doc = fortyTransforms(shape);
    bench(
      `${shape === 'chain' ? 'each reading the one before' : 'all independent'}, recorded as a durable run records it`,
      async () => {
        const result = await execute(doc, {
          input: { x: 1 },
          recorder: createRecorder({ now: () => Date.now() }),
        });
        if (result.status !== 'success') {
          throw new Error(`the recorded ${shape} run ended ${result.status}`);
        }
      },
      { iterations: 5 },
    );
  }
  bench.todo('all independent, four steps at once with a pool of four');
  bench.todo("a 40-node document's plan, cold and cached");
});
