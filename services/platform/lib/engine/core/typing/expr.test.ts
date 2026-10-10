// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { parseExpressionIn } from '../syntax/parse';
import { collectRefs } from '../syntax/walk';
import { rootShapeOf, typeOfExpression, type TypeEnv } from './expr';
import { normalizeSchema } from './normalize';
import { toTs, type Shape } from './shape';
import { parseSignature } from './signature';

function sig(text: string): Shape {
  const parsed = parseSignature(text);
  if ('error' in parsed) throw new Error(parsed.error.message);
  return parsed.shape;
}

const OUTPUTS: Record<string, Shape> = {
  issues: sig(
    '{ issues: Array<{ number: number, title: string, labels?: string[] }>, next: string | null }',
  ),
  triage: normalizeSchema({
    type: 'object',
    properties: { summary: { type: 'string' } },
    required: ['summary'],
  }),
};

const ENV: TypeEnv = {
  input: normalizeSchema({
    type: 'object',
    properties: { limit: { type: 'number' }, owner: { type: 'string' } },
    required: ['owner'],
  }),
  nodes: (id) => (Object.hasOwn(OUTPUTS, id) ? OUTPUTS[id] : undefined),
};

function ts(expr: string, env: TypeEnv = ENV): string {
  const parsed = parseExpressionIn(expr, 0, expr.length);
  if (!parsed.ok) throw new Error(parsed.message);
  return toTs(typeOfExpression(parsed.ast, env));
}

describe('typeOfExpression — roots and members', () => {
  it.each([
    ['input.owner', 'string'],
    ['input.limit', 'number | null'],
    ['input.nope', 'unknown'],
    ['nodes.issues.output.issues[0].title', 'string'],
    ['nodes.issues.output.issues.length', 'number'],
    ['nodes.issues.output.next', 'string | null'],
    ['nodes.issues.output.issues[0].labels', 'Array<string> | null'],
    ["nodes['issues'].output.issues[0].number", 'number'],
    ['nodes.missing.output', 'unknown'],
    [
      'nodes.issues',
      '{ output: { issues: Array<{ number: number, title: string, labels?: Array<string> }>, next: string | null } }',
    ],
    ['nodes', 'unknown'],
    ['item', 'unknown'],
    ['index', 'unknown'],
  ])('%s → %s', (expr, expected) => {
    expect(ts(expr)).toBe(expected);
  });

  it('reads item, index and output where the environment has them', () => {
    const env: TypeEnv = {
      ...ENV,
      item: sig('{ id: string }'),
      index: true,
      output: sig('{ status: string }'),
    };
    expect(ts('item.id', env)).toBe('string');
    expect(ts('index', env)).toBe('number');
    expect(ts('output.status', env)).toBe('string');
  });

  it('adds null to a chain an optional step may cut short', () => {
    const env: TypeEnv = {
      ...ENV,
      nodes: (id) =>
        id === 'maybe'
          ? { anyOf: [sig('{ a: { b: string } }'), { type: 'null' }] }
          : undefined,
    };
    expect(ts('nodes.maybe.output?.a.b', env)).toBe('string | null');
    expect(ts('nodes.maybe.output.a.b', env)).toBe('string');
  });
});

describe('typeOfExpression — literals and operators', () => {
  it.each([
    ["'open'", '"open"'],
    ['42', '42'],
    ['true', 'true'],
    ['null', 'null'],
    ['undefined', 'null'],
    ['`#${input.owner}`', 'string'],
    ["[1, 'a']", 'Array<number | string>'],
    ['[]', 'Array<unknown>'],
    ["({ a: 1, b: 'x' })", '{ a: number, b: string }'],
    ['({ ...input })', 'unknown'],
    ['!input.owner', 'boolean'],
    ['typeof input.owner', 'string'],
    ['input.limit > 3', 'boolean'],
    ["'x' in input", 'boolean'],
    ['input.limit * 2', 'number'],
    ["input.owner + '/'", 'string'],
    ['1 + 2', 'number'],
    ['input.nope + 1', 'unknown'],
    ['input.limit ?? 50', 'number'],
    ['nodes.triage.output?.summary ?? null', 'string | null'],
    ["input.owner || 'none'", 'string'],
    ['input.owner && input.limit', 'string | number | null'],
    ["input.limit > 1 ? 'many' : 'one'", '"many" | "one"'],
    ['(input.owner, input.limit)', 'number | null'],
  ])('%s → %s', (expr, expected) => {
    expect(ts(expr)).toBe(expected);
  });

  it('keeps a list when the fallback is the empty literal', () => {
    expect(ts('nodes.issues.output.issues ?? []')).toBe(
      'Array<{ number: number, title: string, labels?: Array<string> }>',
    );
    expect(ts('Array.isArray(input.x) ? nodes.issues.output.issues : []')).toBe(
      'Array<{ number: number, title: string, labels?: Array<string> }>',
    );
    expect(ts('input.owner ?? []')).toBe('string | Array<unknown>');
  });
});

describe('typeOfExpression — methods and globals', () => {
  it.each([
    ['nodes.issues.output.issues.map((i) => i.title)', 'Array<string>'],
    [
      'nodes.issues.output.issues.map((i, n) => ({ n, t: i.title }))',
      'Array<{ n: number, t: string }>',
    ],
    [
      'nodes.issues.output.issues.map(function (i) { const x = 1; return i.number; })',
      'Array<number>',
    ],
    [
      'nodes.issues.output.issues.map((i) => { if (i) return 1; return 2; })',
      'Array<unknown>',
    ],
    [
      'nodes.issues.output.issues.filter((i) => i.number > 1)',
      'Array<{ number: number, title: string, labels?: Array<string> }>',
    ],
    [
      'nodes.issues.output.issues.find((i) => i.number > 1)',
      '{ number: number, title: string, labels?: Array<string> } | null',
    ],
    ['nodes.issues.output.issues.some((i) => i.number > 1)', 'boolean'],
    ["nodes.issues.output.issues.map((i) => i.title).join(', ')", 'string'],
    ['nodes.issues.output.issues.reduce((a, i) => a + i.number, 0)', 'unknown'],
    ['input.owner.trim().toLowerCase()', 'string'],
    ["input.owner.split('/')", 'Array<string>'],
    ["input.owner.startsWith('x')", 'boolean'],
    ['input.limit.toFixed(2)', 'string'],
    ['JSON.stringify(input)', 'string'],
    ['JSON.parse(input.owner)', 'unknown'],
    ['Math.max(1, 2)', 'number'],
    ['Number(input.owner)', 'number'],
    ['String(input.limit)', 'string'],
    ['Array.isArray(input.owner)', 'boolean'],
    ['Object.keys(input)', 'Array<string>'],
    [
      'Object.values(nodes.issues.output)',
      'Array<Array<{ number: number, title: string, labels?: Array<string> }> | string | null>',
    ],
    ['Date.now()', 'number'],
    ['input.owner.custom()', 'unknown'],
  ])('%s → %s', (expr, expected) => {
    expect(ts(expr)).toBe(expected);
  });

  it('lets a callback parameter shadow a scope name', () => {
    expect(ts('nodes.issues.output.issues.map((input) => input.title)')).toBe(
      'Array<string>',
    );
  });

  it('reads locals the caller declares before the scope', () => {
    const env: TypeEnv = {
      ...ENV,
      locals: new Map<string, Shape>([
        ['issues', sig('Array<{ id: string }>')],
        ['input', {}],
      ]),
    };
    expect(ts('issues[0].id', env)).toBe('string');
    expect(ts('input.owner', env)).toBe('unknown');
    expect(ts('Math.max(1)', env)).toBe('number');
  });
});

describe('rootShapeOf', () => {
  it('starts a reference site at its root', () => {
    const expr = 'nodes.issues.output.issues[0] && input.owner';
    const parsed = parseExpressionIn(expr, 0, expr.length);
    if (!parsed.ok) throw new Error(parsed.message);
    const [nodeSite, inputSite] = collectRefs(parsed.ast, {
      roots: new Set(['input', 'nodes']),
    });
    expect(rootShapeOf(nodeSite, ENV)).toBe(OUTPUTS.issues);
    expect(rootShapeOf(inputSite, ENV)).toBe(ENV.input);
    expect(
      rootShapeOf({ ...nodeSite, member: 'outputs' }, ENV),
    ).toBeUndefined();
  });
});
