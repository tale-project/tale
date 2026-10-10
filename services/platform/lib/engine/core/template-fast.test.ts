// @vitest-environment node

import { randomJson, seeded, type Random } from '@tale/ui/data/random-json';
import { describe, expect, it } from 'vitest';

import { nodeVmRunner } from '../runners/node-vm';
import { RUNNER, resolveFast, unitPlan } from './template-fast';

/**
 * The template fast path reads a unit from the scope only when it answers
 * exactly what the code runner answers; on any doubt it hands the unit to
 * the runner. The property below holds the two to each other over
 * thousands of generated units and scopes, in-memory values a JSON copy
 * changes included.
 */

const runner = nodeVmRunner();
const LIMITS = { timeoutMs: 1000 };

/** What the fast path answers for `source`, or RUNNER. */
function fast(source: string, scope: Record<string, unknown>): unknown {
  const plan = unitPlan(source);
  return plan.kind === 'fast' ? resolveFast(plan.term, scope) : RUNNER;
}

/** `[1, <hole>, 3]`: what a JSON copy fills with null. */
function withHole(): number[] {
  const values = new Array<number>(3);
  values[0] = 1;
  values[2] = 3;
  return values;
}

describe('which units the fast path reads', () => {
  it.each([
    'item.title',
    ' nodes.fetch.output.rows[3].name ',
    'input?.owner?.name',
    "nodes['fetch'].output",
    'nodes.fetch.output.rows[index]',
    'nodes.fetch.output.byId[item.id]',
    'input.limit ?? 50',
    "input.title || 'untitled'",
    'input.tags ?? []',
    'input.extra ?? {}',
    'index',
    'null',
    "'text'",
  ])('reads %s', (source) => {
    expect(unitPlan(source).kind).toBe('fast');
  });

  it.each([
    'input.items.length + 1',
    'input.items.map((x) => x.id)',
    'JSON.stringify(input)',
    '(input?.a).b',
    'input.a ?? input.b ?? 1',
    '1 ?? input.a',
    '-1',
    'input[`a${1}`]',
    'missing.name',
    'input.a > 1',
    'typeof input',
    'input.',
  ])('hands %s to the runner', (source) => {
    expect(unitPlan(source).kind).toBe('runner');
  });
});

describe('what a planned unit reads', () => {
  const scope = {
    input: {
      owner: null,
      title: '',
      name: 'Ada',
      rows: [{ id: 'a' }, { id: 'b' }],
      byId: { a: 1 },
    },
    item: { id: 'a' },
    index: 1,
  };

  it('reads paths, fallbacks and computed keys as JSON copies', () => {
    expect(fast('input.rows[index].id', scope)).toBe('b');
    expect(fast('input.byId[item.id]', scope)).toBe(1);
    expect(fast('input.rows.length', scope)).toBe(2);
    expect(fast('input.name.length', scope)).toBe(3);
    expect(fast("input.title || 'untitled'", scope)).toBe('untitled');
    expect(fast("input.title ?? 'untitled'", scope)).toBe('');
    expect(fast('input.owner?.name', scope)).toBeUndefined();
    expect(fast('input.missing', scope)).toBeUndefined();
    const copy = fast('input.rows', scope);
    expect(copy).toEqual(scope.input.rows);
    expect(copy).not.toBe(scope.input.rows);
  });

  it('hands the runner every read whose answer it would phrase itself', () => {
    // A plain read of a missing base is a TypeError the runner words.
    expect(fast('input.owner.name', scope)).toBe(RUNNER);
    // A root the scope does not hold is a ReferenceError.
    expect(fast('output.value', scope)).toBe(RUNNER);
    // Inherited members, and `__proto__`, are the runner's.
    expect(fast('input.constructor', scope)).toBe(RUNNER);
    expect(fast('input.rows.map', scope)).toBe(RUNNER);
    expect(fast('input.name.toUpperCase', scope)).toBe(RUNNER);
    expect(fast('input.__proto__', scope)).toBe(RUNNER);
    // A member of a number or a boolean.
    expect(fast('index.toFixed', scope)).toBe(RUNNER);
  });

  it('leaves to the runner a value its JSON copy would change', () => {
    const odd = {
      input: {
        when: new Date(0),
        bare: Object.assign(Object.create(null), { a: 1 }),
        own: { toJSON: () => 'x', a: 1 },
        holes: withHole(),
      },
    };
    expect(fast('input.when', odd)).toBe(RUNNER);
    expect(fast('input.bare.a', odd)).toBe(RUNNER);
    expect(fast('input.own.a', odd)).toBe(RUNNER);
    expect(fast('input.holes[1]', odd)).toBe(RUNNER);
    expect(fast('input.holes[0]', odd)).toBe(1);
  });
});

// ---------------------------------------------------------------- property

const KEYS = [
  'a',
  'output',
  'items',
  'name',
  'total',
  'status',
  'owner',
  'tags',
  'id',
  'length',
  'note',
  'constructor',
  'toString',
  'map',
];

function pick<T>(random: Random, items: readonly T[]): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error('pick from an empty list');
  return item;
}

/** A path as an author might write it, now and then one the fast path
 * hands to the runner. */
function pathSource(random: Random, depth = 0): string {
  let source = pick(random, ['input', 'nodes', 'item', 'index', 'output']);
  const steps = Math.floor(random() * 4);
  for (let step = 0; step < steps; step += 1) {
    const optional = random() < 0.25 ? '?.' : '';
    const roll = random();
    if (roll < 0.55) {
      source += `${optional || '.'}${pick(random, KEYS)}`;
    } else if (roll < 0.75) {
      source += `${optional}[${Math.floor(random() * 4)}]`;
    } else if (roll < 0.9) {
      source += `${optional}['${pick(random, KEYS)}']`;
    } else if (depth === 0) {
      source += `${optional}[${pathSource(random, 1)}]`;
    }
  }
  return source;
}

function literalSource(random: Random): string {
  return pick(random, [
    'null',
    'true',
    'false',
    '0',
    '42',
    "'x'",
    "''",
    '[]',
    '{}',
  ]);
}

/** A unit: a path, a literal, or a path with a fallback. */
function unitSource(random: Random): string {
  const roll = random();
  if (roll < 0.55) return pathSource(random);
  if (roll < 0.65) return literalSource(random);
  const right = random() < 0.5 ? pathSource(random) : literalSource(random);
  return `${pathSource(random)} ${random() < 0.5 ? '??' : '||'} ${right}`;
}

/** A scope like a run's, now and then holding what a JSON copy changes. */
function scopeOf(random: Random): Record<string, unknown> {
  const scope: Record<string, unknown> = {
    input: {
      total: Math.floor(random() * 10),
      items: randomJson(random, 2),
      name: pick(random, ['Ada', '', 'x'.repeat(30)]),
      owner: random() < 0.5 ? { name: 'Grace' } : null,
      tags: random() < 0.5 ? ['a', 'b'] : [],
      a: randomJson(random, 3),
    },
    nodes: {
      a: { output: randomJson(random, 3) },
      b: { output: { status: 'open', items: [1, 2, 3] } },
    },
    item: randomJson(random, 2),
    index: Math.floor(random() * 3),
  };
  if (random() < 0.15) {
    const input = scope.input as Record<string, unknown>;
    input.a = pick(random, [
      new Date(0),
      Object.assign(Object.create(null), { name: 'bare' }),
      { toJSON: () => 'own', name: 'json' },
      withHole(),
    ]);
  }
  return scope;
}

describe('the fast path answers what the runner answers', () => {
  it('over 2,000 generated units and scopes', async () => {
    const random = seeded(8_2026);
    let read = 0;
    for (let case_ = 0; case_ < 2000; case_ += 1) {
      const source = unitSource(random);
      const scope = scopeOf(random);
      const answer = fast(source, scope);
      let expected: { value: unknown } | { error: string };
      try {
        expected = { value: await runner.evalExpr(source, scope, LIMITS) };
      } catch (error) {
        expected = {
          error: error instanceof Error ? error.message : String(error),
        };
      }
      if (answer === RUNNER) continue;
      read += 1;
      expect(
        { source, answer: 'error' in expected ? expected : { value: answer } },
        `${source} over ${JSON.stringify(scope).slice(0, 200)}`,
      ).toStrictEqual({ source, answer: expected });
    }
    // A third or more of the generated units are ones the fast path reads;
    // the rest exercise what it hands to the runner.
    expect(read).toBeGreaterThan(666);
  }, 60_000);
});
