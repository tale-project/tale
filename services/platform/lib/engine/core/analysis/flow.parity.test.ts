// @vitest-environment node

/**
 * The flow model against the executor: for generated documents and every
 * assignment of their atoms, `simulate` predicts exactly which nodes the
 * in-process executor runs and which it skips, and why.
 *
 * Each document is a random DAG of 2–8 nodes over a seeded generator (so a
 * failure reproduces): data references in the input mapping and in
 * transform code, control references in `when`, `elseOf` branches, and
 * nodes that continue on error. An atom is driven through the run input — a
 * `when` reads `input.w_<id>`, a tolerated failure throws when
 * `input.f_<id>` is true — and the trace's statuses and skip notes are the
 * executor's own account of the run.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { nodeVmRunner } from '../../runners/node-vm';
import { execute } from '../execute';
import { setCodeRunner } from '../runner';
import { registerNodeType } from '../slots';
import type { Automation, NodeDef, NodeTrace } from '../types';
import {
  flowModel,
  simulate,
  type FlowModel,
  type PathSkip,
  type SkipReason,
} from './flow';

const DOCUMENTS = 200;
const MAX_ATOMS = 7;
const SEED = 20261008;

beforeAll(() => {
  setCodeRunner(nodeVmRunner());
  registerNodeType({
    type: 'parity.probe',
    kind: 'connector',
    outputKind: 'structured',
    description: 'test connector: fails on request',
    allowedFields: ['input'],
    requiredFields: ['input'],
    connector: {
      name: 'parity.probe',
      description: 'fails when its input says so',
      inputSchema: { type: 'object' },
      outputSignature: '{ ok: boolean }',
      hasEffect: false,
      mock: (input) => {
        if (
          typeof input === 'object' &&
          input !== null &&
          Reflect.get(input, 'fail') === true
        ) {
          throw new Error('planned failure');
        }
        return { ok: true };
      },
    },
  });
});

/** mulberry32: a small deterministic generator. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, xs: readonly T[]): T {
  return xs[Math.floor(rand() * xs.length)];
}

function generate(rand: () => number, index: number): Automation {
  const count = 2 + Math.floor(rand() * 7);
  const nodes: NodeDef[] = [];
  for (let i = 0; i < count; i++) {
    const id = `n${i}`;
    const earlier = nodes.map((n) => n.id);
    const transform = rand() < 0.5;
    const data = earlier.filter(() => rand() < 0.35);
    const inCode = transform ? data.filter(() => rand() < 0.3) : [];
    const input: Record<string, unknown> = {};
    for (const ref of data.filter((r) => !inCode.includes(r))) {
      input[`r_${ref}`] = `{{ nodes.${ref}.output }}`;
    }
    const node: NodeDef = transform
      ? {
          id,
          type: 'transform',
          code: [
            ...inCode.map((ref) => `const seen_${ref} = nodes.${ref}.output;`),
            "if (input.fail === true) throw new Error('planned failure');",
            `return { at: ${i} };`,
          ].join('\n'),
        }
      : { id, type: 'parity.probe' };
    if (rand() < 0.3) {
      node.onError = 'continue';
      input.fail = `{{ input.f_${id} }}`;
    }
    node.input = input;
    if (rand() < 0.4) {
      const control =
        earlier.length > 0 && rand() < 0.4 ? pick(rand, earlier) : undefined;
      node.when =
        control === undefined
          ? `{{ input.w_${id} }}`
          : `{{ (nodes.${control}.output, input.w_${id}) }}`;
    }
    if (earlier.length > 0 && rand() < 0.2) {
      const withWhen = nodes
        .filter((n) => n.when !== undefined)
        .map((n) => n.id);
      node.elseOf =
        withWhen.length > 0 && rand() < 0.8
          ? pick(rand, withWhen)
          : pick(rand, earlier);
    }
    nodes.push(node);
  }
  return { version: 1, name: `parity-${index}`, nodes };
}

/** What the trace says happened, in the model's terms. */
function traced(trace: NodeTrace[]): { ran: string[]; skipped: PathSkip[] } {
  const ran: string[] = [];
  const skipped: PathSkip[] = [];
  for (const entry of trace) {
    if (entry.status === 'ok') {
      ran.push(entry.node);
      continue;
    }
    if (entry.status === 'error') {
      expect(entry.note).toBe('onError: continue — dependents are skipped');
      skipped.push({ nodeId: entry.node, reason: 'error' });
      continue;
    }
    expect(entry.status).toBe('skipped');
    const note = entry.note ?? '';
    const upstream = /^skipped: reads from skipped node\(s\) (.+)$/.exec(note);
    let reason: SkipReason;
    if (upstream !== null) {
      skipped.push({
        nodeId: entry.node,
        reason: 'upstream',
        via: upstream[1].split(', ')[0],
      });
      continue;
    }
    if (note.startsWith('skipped: elseOf partner')) reason = 'else';
    else if (note.startsWith('skipped: when=')) reason = 'when';
    else throw new Error(`unexpected skip note: ${note}`);
    skipped.push({ nodeId: entry.node, reason });
  }
  return { ran, skipped };
}

function assignments(model: FlowModel): Array<Record<string, boolean>> {
  const atoms = model.atoms.map((a) => a.id);
  return Array.from({ length: 2 ** atoms.length }, (_, mask) =>
    Object.fromEntries(
      atoms.map((atom, bit) => [atom, (mask & (1 << bit)) !== 0]),
    ),
  );
}

function runInput(
  assignment: Record<string, boolean>,
): Record<string, boolean> {
  return Object.fromEntries(
    Object.entries(assignment).map(([atom, value]) => {
      const [kind, id] = atom.split(':');
      return [`${kind === 'when' ? 'w' : 'f'}_${id}`, value];
    }),
  );
}

describe('the flow model replays the executor', () => {
  it(`matches every run of ${DOCUMENTS} generated documents`, async () => {
    const rand = seeded(SEED);
    let runs = 0;
    const shapes = { else: 0, upstream: 0, when: 0, error: 0 };
    for (let d = 0; d < DOCUMENTS; d++) {
      let doc = generate(rand, d);
      let model = flowModel(doc.nodes);
      while (model === null || model.atoms.length > MAX_ATOMS) {
        doc = generate(rand, d);
        model = flowModel(doc.nodes);
      }
      const m = model;
      await Promise.all(
        assignments(m).map(async (assignment) => {
          const result = await execute(doc, {
            input: runInput(assignment),
            mode: 'mock',
          });
          const context = `document ${d} ${JSON.stringify(doc.nodes)} with ${JSON.stringify(assignment)}`;
          expect(result.status, context).toBe('success');
          const predicted = simulate(m, assignment);
          const actual = traced(result.trace);
          expect(actual, context).toEqual({
            ran: predicted.ran,
            skipped: predicted.skipped,
          });
          for (const s of predicted.skipped) shapes[s.reason]++;
          runs++;
        }),
      );
    }
    // The generator exercised every rule, many times over.
    expect(runs).toBeGreaterThan(DOCUMENTS * 4);
    for (const count of Object.values(shapes)) {
      expect(count).toBeGreaterThan(50);
    }
  }, 300_000);
});
