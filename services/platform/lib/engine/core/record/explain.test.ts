// @vitest-environment node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { randomJson, seeded, type Random } from '@tale/ui/data/random-json';
import { summaryOf, type ValueSummary } from '@tale/ui/data/value-summary';
import type { MemberExpression, Node } from 'estree';
import { beforeAll, describe, expect, it } from 'vitest';

import { nodeVmRunner } from '../../runners/node-vm';
import { setCodeRunner } from '../runner';
import { parseExpressionIn } from '../syntax/parse';
import { renderPath } from '../syntax/walk';
import { evalConditionTraced } from '../template';
import {
  EXPLAIN_MAX_DEPTH,
  EXPLAIN_MAX_NODES,
  EXPLAIN_SOURCE_LENGTH,
  explainCondition,
  type ExplainNode,
  type ExplainRef,
} from './explain';
import type { EvalTrace, EvalUnitTrace } from './types';

/** [start, end) of the `nth` occurrence of `text` in `field`. */
function at(field: string, text: string, nth = 0): [number, number] {
  let from = -1;
  for (let i = 0; i <= nth; i++) {
    from = field.indexOf(text, from + 1);
    if (from === -1) throw new Error(`"${text}" #${nth} is not in "${field}"`);
  }
  return [from, from + text.length];
}

/** A probe: the text it was taken over (its first occurrence) or its
 * range, and the value it saw. */
type Probe = [where: string | [number, number], value: unknown];

function unitOf(
  field: string,
  range: [number, number],
  probes: Probe[] = [],
): EvalUnitTrace {
  return {
    range,
    probes: probes.map(([where, value]) => ({
      range: typeof where === 'string' ? at(field, where) : where,
      v: summaryOf(value),
    })),
    probed: 'full',
  };
}

function traceOf(units: EvalUnitTrace[]): EvalTrace {
  return { pointer: '/nodes/0/when', units };
}

/** The tree of a bare condition that is the whole field. */
function explainOne(field: string, probes: Probe[] = []): ExplainNode {
  const [tree] = explainCondition(
    field,
    traceOf([unitOf(field, [0, field.length], probes)]),
  );
  return tree;
}

/** The tree of a bare condition whose evaluation threw: nothing vouches for
 * a part but its own probe — how a unit with no probe of its whole reads in
 * a real run. */
function explainThrown(field: string, probes: Probe[] = []): ExplainNode {
  const [tree] = explainCondition(
    field,
    traceOf([
      {
        ...unitOf(field, [0, field.length], probes),
        error: { message: 'the expression threw' },
      },
    ]),
  );
  return tree;
}

function refText(ref: ExplainRef): string {
  const head = ref.root === 'nodes' ? `nodes.${ref.nodeId}.output` : ref.root;
  return `${head}${renderPath(ref.path.map((key) => ({ key })))}`;
}

function valueText(value: ValueSummary): string {
  switch (value.kind) {
    case 'string':
      return JSON.stringify(value.text);
    case 'number':
    case 'boolean':
      return value.text ?? value.kind;
    case 'array':
      return `[${value.length}]`;
    case 'object':
      return `{${(value.names ?? []).join(',')}}`;
    default:
      return value.kind;
  }
}

/** One line per tree: `kind op ref = value [children]`, with the nodes
 * that did not run marked. */
function brief(node: ExplainNode): string {
  const head = [node.kind, node.op, node.ref && refText(node.ref)]
    .filter((part) => part !== undefined)
    .join(' ');
  const value = node.value === undefined ? '' : ` = ${valueText(node.value)}`;
  const skipped = node.evaluated ? '' : ' (not evaluated)';
  const children =
    node.children.length === 0
      ? ''
      : ` [${node.children.map(brief).join(', ')}]`;
  return `${head}${value}${skipped}${children}`;
}

function countNodes(node: ExplainNode): number {
  return 1 + node.children.reduce((n, child) => n + countNodes(child), 0);
}

describe('explainCondition', () => {
  describe('comparisons and literals', () => {
    it('answers each operand with its range, source and value', () => {
      const field = 'input.total > 1000';
      expect(
        explainOne(field, [
          [field, false],
          ['input.total', 250],
        ]),
      ).toEqual({
        range: [0, 18],
        source: 'input.total > 1000',
        kind: 'compare',
        op: '>',
        value: summaryOf(false),
        evaluated: true,
        children: [
          {
            range: [0, 11],
            source: 'input.total',
            kind: 'ref',
            ref: { root: 'input', path: ['total'] },
            value: summaryOf(250),
            evaluated: true,
            children: [],
          },
          {
            range: [14, 18],
            source: '1000',
            kind: 'literal',
            value: summaryOf(1000),
            evaluated: true,
            children: [],
          },
        ],
      });
    });

    it('reads every literal form from the text, never from a probe', () => {
      expect(brief(explainThrown("input.s === 'open'"))).toBe(
        'compare === (not evaluated) [ref input.s (not evaluated), literal = "open"]',
      );
      expect(brief(explainThrown('input.n > -1'))).toBe(
        'compare > (not evaluated) [ref input.n (not evaluated), literal = -1]',
      );
      expect(
        brief(explainThrown('input.x === undefined')).endsWith(
          'literal = undefined]',
        ),
      ).toBe(true);
      expect(
        brief(explainThrown('input.x !== null')).endsWith('literal = null]'),
      ).toBe(true);
      expect(
        brief(explainThrown('input.s === `abc`')).endsWith('literal = "abc"]'),
      ).toBe(true);
      expect(
        brief(explainThrown('10n > input.n')).startsWith(
          'compare > (not evaluated) [literal = 10,',
        ),
      ).toBe(true);
      expect(
        brief(explainThrown("['open', 'done'].includes(input.status)")),
      ).toBe(
        'call includes (not evaluated) [literal = [2], ref input.status (not evaluated)]',
      );
      expect(
        brief(explainThrown('input.x === Infinity || input.y !== NaN')),
      ).toBe(
        'logical || (not evaluated) [compare === (not evaluated) [ref input.x (not evaluated), literal = Infinity], compare !== (not evaluated) [ref input.y (not evaluated), literal = NaN]]',
      );
      // A probe at a literal's range never overrides what the text says.
      const field = 'input.n > 5';
      expect(explainThrown(field, [['5', 6]]).children[1].value).toEqual(
        summaryOf(5),
      );
    });

    it('keeps a regular expression a literal without a value', () => {
      const field = '/^a/i.test(input.s)';
      const tree = explainOne(field, [[field, true]]);
      expect(brief(tree)).toBe('call test = true [literal, ref input.s]');
      expect(tree.children[0]).toMatchObject({
        source: '/^a/i',
        evaluated: true,
      });
      expect(tree.children[0].value).toBeUndefined();
    });

    it('explains a template with expressions by its expressions', () => {
      expect(
        brief(explainThrown('`${input.first} ${input.last}` === input.full')),
      ).toBe(
        'compare === (not evaluated) [other (not evaluated) [ref input.first (not evaluated), ref input.last (not evaluated)], ref input.full (not evaluated)]',
      );
    });

    it('names arithmetic and keeps lists and objects that read values', () => {
      const field = '(input.a + 1) * -input.b > [input.c].length';
      expect(brief(explainThrown(field))).toBe(
        'compare > (not evaluated) [arith * (not evaluated) [arith + (not evaluated) [ref input.a (not evaluated), literal = 1], arith - (not evaluated) [ref input.b (not evaluated)]], call length (not evaluated) [other (not evaluated) [ref input.c (not evaluated)]]]',
      );
      expect(brief(explainThrown('({ a: input.a, ...input.b }).a'))).toBe(
        'call a (not evaluated) [other (not evaluated) [ref input.a (not evaluated), ref input.b (not evaluated)]]',
      );
    });
  });

  describe('logical chains and short circuits', () => {
    it('flattens an && chain and leaves the operands it never reached unevaluated', () => {
      const field = 'input.a && input.b && input.c';
      expect(
        brief(
          explainOne(field, [
            [field, 0],
            ['input.a && input.b', 0],
            ['input.a', 0],
          ]),
        ),
      ).toBe(
        'logical && = 0 [ref input.a = 0, ref input.b (not evaluated), ref input.c (not evaluated)]',
      );
    });

    it('flattens a right-nested chain of the same operator too', () => {
      const field = 'input.a && (input.b && input.c)';
      expect(explainOne(field).children.map((child) => child.source)).toEqual([
        'input.a',
        'input.b',
        'input.c',
      ]);
    });

    it('stops an || chain at the first truthy operand', () => {
      const field = 'input.a || input.b || input.c';
      expect(
        brief(
          explainOne(field, [
            [field, 'x'],
            ['input.a || input.b', 'x'],
            ['input.a', ''],
            ['input.b', 'x'],
          ]),
        ),
      ).toBe(
        'logical || = "x" [ref input.a = "", ref input.b = "x", ref input.c (not evaluated)]',
      );
    });

    it('reads a ?? chain to its fallback', () => {
      const field = "input.a ?? input.b ?? 'none'";
      expect(
        brief(
          explainOne(field, [
            [field, 'none'],
            ['input.a ?? input.b', null],
            ['input.a', null],
            ['input.b', null],
          ]),
        ),
      ).toBe(
        'logical ?? = "none" [ref input.a = null, ref input.b = null, literal = "none"]',
      );
    });

    it('does not flatten across operators', () => {
      const field = 'input.a && input.b || input.c';
      expect(
        brief(
          explainOne(field, [
            [field, 2],
            ['input.a && input.b', 0],
            ['input.a', 1],
            ['input.b', 0],
            ['input.c', 2],
          ]),
        ),
      ).toBe(
        'logical || = 2 [logical && = 0 [ref input.a = 1, ref input.b = 0], ref input.c = 2]',
      );
    });

    it('marks a whole short-circuited comparison unevaluated, its literal aside', () => {
      const field = 'input.n > 1 && input.m < 2';
      expect(
        brief(
          explainOne(field, [
            [field, false],
            ['input.n > 1', false],
            ['input.n', 0],
          ]),
        ),
      ).toBe(
        'logical && = false [compare > = false [ref input.n = 0, literal = 1], compare < (not evaluated) [ref input.m (not evaluated), literal = 2]]',
      );
    });

    it('explains ! and !!', () => {
      expect(
        brief(
          explainOne('!input.done', [
            ['!input.done', false],
            ['input.done', true],
          ]),
        ),
      ).toBe('not ! = false [ref input.done = true]');
      expect(brief(explainOne('!!input.x', [['!!input.x', true]]))).toBe(
        'not ! = true [not ! [ref input.x]]',
      );
    });

    it('explains a ternary through the branch it took', () => {
      const field = 'input.vip ? input.total > 10 : input.total > 100';
      expect(
        brief(
          explainOne(field, [
            [field, false],
            ['input.vip', false],
            ['input.total > 100', false],
            [at(field, 'input.total', 1), 50],
          ]),
        ),
      ).toBe(
        'conditional ?: = false [ref input.vip = false, compare > (not evaluated) [ref input.total (not evaluated), literal = 10], compare > = false [ref input.total = 50, literal = 100]]',
      );
    });
  });

  describe('calls', () => {
    it('names a method by its name, its receiver and arguments run with it', () => {
      const field = "input.tags.includes('urgent')";
      const tree = explainOne(field, [[field, true]]);
      expect(brief(tree)).toBe(
        'call includes = true [ref input.tags, literal = "urgent"]',
      );
      // The receiver ran (the call came to a value) though no probe kept it.
      expect(tree.children[0]).toMatchObject({
        evaluated: true,
        range: at(field, 'input.tags'),
      });
      expect(tree.children[0].value).toBeUndefined();
    });

    it('leaves a call the chain never reached unevaluated, receiver and all', () => {
      const field = "input.ok && input.tags.includes('x')";
      expect(
        brief(
          explainOne(field, [
            [field, false],
            ['input.ok', false],
          ]),
        ),
      ).toBe(
        'logical && = false [ref input.ok = false, call includes (not evaluated) [ref input.tags (not evaluated), literal = "x"]]',
      );
    });

    it('reads .length off a computed value as a named read of it', () => {
      const field = 'input.items.filter((i) => i.open).length > 0';
      expect(
        brief(
          explainOne(field, [
            [field, true],
            ['input.items.filter((i) => i.open)', [{ open: true }]],
          ]),
        ),
      ).toBe(
        'compare > = true [call length [call filter = [1] [ref input.items, other]], literal = 0]',
      );
    });

    it('keeps a global namespace in the name, not as an operand', () => {
      expect(brief(explainThrown('Object.keys(input.meta).length === 0'))).toBe(
        'compare === (not evaluated) [call length (not evaluated) [call Object.keys (not evaluated) [ref input.meta (not evaluated)]], literal = 0]',
      );
      expect(brief(explainThrown('Array.isArray(input.x)'))).toBe(
        'call Array.isArray (not evaluated) [ref input.x (not evaluated)]',
      );
      expect(brief(explainThrown('Number(input.n) >= 18'))).toBe(
        'compare >= (not evaluated) [call Number (not evaluated) [ref input.n (not evaluated)], literal = 18]',
      );
      expect(
        brief(explainThrown("new Date(input.at) < new Date('2026-01-01')")),
      ).toBe(
        'compare < (not evaluated) [call Date (not evaluated) [ref input.at (not evaluated)], call Date (not evaluated) [literal = "2026-01-01"]]',
      );
      expect(brief(explainThrown('Math.max(...input.xs) > Math.PI'))).toBe(
        'compare > (not evaluated) [call Math.max (not evaluated) [ref input.xs (not evaluated)], other (not evaluated)]',
      );
    });

    it('calls a scope value by its method name, the value as the receiver', () => {
      expect(brief(explainThrown("item.startsWith('A')"))).toBe(
        'call startsWith (not evaluated) [ref item (not evaluated), literal = "A"]',
      );
    });

    it('explains typeof, void and a computed callee', () => {
      expect(brief(explainThrown("typeof input.x === 'string'"))).toBe(
        'compare === (not evaluated) [other typeof (not evaluated) [ref input.x (not evaluated)], literal = "string"]',
      );
      expect(brief(explainThrown('void input.x'))).toBe(
        'other void (not evaluated) [ref input.x (not evaluated)]',
      );
      expect(brief(explainThrown('input.fns[input.k](1)'))).toBe(
        'call (not evaluated) [ref input.fns (not evaluated), ref input.k (not evaluated), literal = 1]',
      );
      expect(brief(explainThrown('(input.f || input.g)(1)'))).toBe(
        'call (not evaluated) [logical || (not evaluated) [ref input.f (not evaluated), ref input.g (not evaluated)], literal = 1]',
      );
    });
  });

  describe('references', () => {
    it('names a member chain from each scope root, static keys only', () => {
      const refOf = (field: string): ExplainRef | undefined =>
        explainOne(field).ref;
      expect(refOf('input.order.lines[0].sku')).toEqual({
        root: 'input',
        path: ['order', 'lines', 0, 'sku'],
      });
      expect(refOf("item['first-name']")).toEqual({
        root: 'item',
        path: ['first-name'],
      });
      expect(refOf('item[`id`]')).toEqual({ root: 'item', path: ['id'] });
      expect(refOf('index')).toEqual({ root: 'index', path: [] });
      expect(refOf('output.done')).toEqual({ root: 'output', path: ['done'] });
      expect(refOf('input')).toEqual({ root: 'input', path: [] });
      expect(refOf('nodes.fetch.output')).toEqual({
        root: 'nodes',
        nodeId: 'fetch',
        path: [],
      });
      expect(refOf("nodes['my-step'].output.ok")).toEqual({
        root: 'nodes',
        nodeId: 'my-step',
        path: ['ok'],
      });
    });

    it("keeps a step's output under a deeper read of it", () => {
      const field = 'nodes.fetch.output.items.length';
      const tree = explainOne(field, [
        [field, 3],
        ['nodes.fetch.output', { items: [1, 2, 3] }],
      ]);
      expect(brief(tree)).toBe(
        'ref nodes.fetch.output.items.length = 3 [ref nodes.fetch.output = {items}]',
      );
      expect(tree.children[0].range).toEqual(at(field, 'nodes.fetch.output'));
    });

    it('answers why a read failed: the output it passed through', () => {
      const field = 'nodes.fetch.output.items.length > 0';
      expect(
        brief(explainThrown(field, [['nodes.fetch.output', { status: 'ok' }]])),
      ).toBe(
        'compare > (not evaluated) [ref nodes.fetch.output.items.length (not evaluated) [ref nodes.fetch.output = {status}], literal = 0]',
      );
    });

    it('leaves reads it cannot name as other', () => {
      expect(brief(explainThrown('nodes'))).toBe('other (not evaluated)');
      expect(brief(explainThrown('nodes.fetch'))).toBe('other (not evaluated)');
      expect(brief(explainThrown('nodes.fetch.status'))).toBe(
        'other (not evaluated)',
      );
      expect(brief(explainThrown('Object.keys(nodes).length'))).toBe(
        'call length (not evaluated) [call Object.keys (not evaluated) [other (not evaluated)]]',
      );
      expect(brief(explainThrown('Math.PI * input.r'))).toBe(
        'arith * (not evaluated) [other (not evaluated), ref input.r (not evaluated)]',
      );
      expect(brief(explainThrown('undeclared.x === 1'))).toBe(
        'compare === (not evaluated) [other (not evaluated), literal = 1]',
      );
    });

    it('explains a dynamic key as a computed read of its parts', () => {
      expect(brief(explainThrown('input.items[index]'))).toBe(
        'other [] (not evaluated) [ref input.items (not evaluated), ref index (not evaluated)]',
      );
      expect(brief(explainThrown('input.items[index].name'))).toBe(
        'call name (not evaluated) [other [] (not evaluated) [ref input.items (not evaluated), ref index (not evaluated)]]',
      );
      expect(brief(explainThrown('nodes[input.id].output.ok'))).toBe(
        'call ok (not evaluated) [call output (not evaluated) [other [] (not evaluated) [other (not evaluated), ref input.id (not evaluated)]]]',
      );
    });
  });

  describe('optional chains', () => {
    it('vouches for the parts of a chain that came to a value', () => {
      const field = 'nodes.fetch?.output?.items?.length > 0';
      const chain = 'nodes.fetch?.output?.items?.length';
      expect(
        brief(
          explainOne(field, [
            [field, true],
            [chain, 2],
          ]),
        ),
      ).toBe(
        'compare > = true [ref nodes.fetch.output.items.length = 2 [ref nodes.fetch.output], literal = 0]',
      );
    });

    it('vouches for nothing inside a chain that came out undefined', () => {
      const field = 'nodes.fetch?.output?.items?.length > 0';
      const chain = 'nodes.fetch?.output?.items?.length';
      expect(
        brief(
          explainOne(field, [
            [field, false],
            [chain, undefined],
          ]),
        ),
      ).toBe(
        'compare > = false [ref nodes.fetch.output.items.length = undefined [ref nodes.fetch.output (not evaluated)], literal = 0]',
      );
    });

    it('treats an optional call the same way', () => {
      const field = "input.tags?.includes('x')";
      expect(brief(explainOne(field, [[field, true]]))).toBe(
        'call includes = true [ref input.tags, literal = "x"]',
      );
      // It came out empty: the receiver ran, and was what was missing.
      expect(brief(explainOne(field, [[field, undefined]]))).toBe(
        'call includes = undefined [ref input.tags, literal = "x"]',
      );
      // A withheld value says nothing of a short circuit; the part before
      // the `?.` ran whenever the chain did.
      const [tree] = explainCondition(
        field,
        traceOf([
          {
            range: [0, field.length],
            probes: [{ range: [0, field.length], v: { kind: 'redacted' } }],
            probed: 'full',
          },
        ]),
      );
      expect(brief(tree)).toBe(
        'call includes = redacted [ref input.tags, literal = "x"]',
      );
    });

    it('reads a parenthesized chain as one reference', () => {
      expect(explainOne('(input?.a).b').ref).toEqual({
        root: 'input',
        path: ['a', 'b'],
      });
    });
  });

  describe('fields and units', () => {
    it('answers one tree per unit of a mixed-text field, in field offsets', () => {
      const field = 'Total {{ input.total }} of {{ input.limit > 5 }}';
      const trees = explainCondition(
        field,
        traceOf([
          unitOf(field, at(field, 'input.total'), [['input.total', 3]]),
          unitOf(field, at(field, 'input.limit > 5'), [
            ['input.limit > 5', true],
            ['input.limit', 9],
          ]),
        ]),
      );
      expect(trees.map(brief)).toEqual([
        'ref input.total = 3',
        'compare > = true [ref input.limit = 9, literal = 5]',
      ]);
      expect(trees[1].children[1].range).toEqual(at(field, '5'));
      expect(trees[1].children[1].source).toBe('5');
    });

    it('explains a bare expression inside surrounding whitespace', () => {
      const field = '  input.ok  ';
      const [tree] = explainCondition(
        field,
        traceOf([unitOf(field, [2, 10], [[[2, 10], true]])]),
      );
      expect(tree).toMatchObject({ range: [2, 10], source: 'input.ok' });
      expect(brief(tree)).toBe('ref input.ok = true');
    });

    it('answers one other node for a unit that does not parse', () => {
      const field = 'Hi {{ input. }} and {{ }}';
      const trees = explainCondition(
        field,
        traceOf([
          unitOf(field, at(field, 'input.')),
          unitOf(field, [field.length - 3, field.length - 3]),
        ]),
      );
      expect(trees).toEqual([
        {
          range: at(field, 'input.'),
          source: 'input.',
          kind: 'other',
          evaluated: false,
          children: [],
        },
        {
          range: [field.length - 3, field.length - 3],
          source: '',
          kind: 'other',
          evaluated: false,
          children: [],
        },
      ]);
    });

    it('holds a unit range that does not fit the field inside it', () => {
      const field = 'input.ok';
      const trees = explainCondition(
        field,
        traceOf([
          unitOf(field, [5, 99]),
          unitOf(field, [6, 2]),
          unitOf(field, [-4, 3]),
          unitOf(field, [Number.NaN, 3]),
        ]),
      );
      expect(trees.map((tree) => [tree.range, tree.source, tree.kind])).toEqual(
        [
          [[5, 8], '.ok', 'other'],
          [[6, 6], '', 'other'],
          [[0, 3], 'inp', 'other'],
          [[0, 3], 'inp', 'other'],
        ],
      );
    });

    it('matches probes by exact range only, the first of a range winning', () => {
      const field = 'input.total > 1';
      const tree = explainOne(field, [
        [field, true],
        [[0, 10], 'near miss'],
        [[0, 12], 'near miss'],
      ]);
      expect(tree.children[0].value).toBeUndefined();
      expect(tree.children[0].evaluated).toBe(true);
      const twice = explainOne(field, [
        ['input.total', 4],
        ['input.total', 5],
      ]);
      expect(twice.children[0].value).toEqual(summaryOf(4));
    });

    it('vouches for literals only when the unit ran without probes', () => {
      const field = 'input.n > 1';
      const [tree] = explainCondition(
        field,
        traceOf([{ range: [0, field.length], probes: [], probed: 'none' }]),
      );
      expect(brief(tree)).toBe(
        'compare > (not evaluated) [ref input.n (not evaluated), literal = 1]',
      );
    });

    it('answers nothing for a trace without units', () => {
      expect(explainCondition('input.ok', traceOf([]))).toEqual([]);
    });

    it('reads the trace without changing it', () => {
      const field = "input.a && input.tags?.includes('x')";
      const trace = traceOf([
        unitOf(
          field,
          [0, field.length],
          [
            [field, true],
            ['input.a', 1],
          ],
        ),
      ]);
      const before = structuredClone(trace);
      const first = explainCondition(field, Object.freeze(trace));
      expect(trace).toEqual(before);
      expect(explainCondition(field, trace)).toEqual(first);
    });
  });

  describe('bounds', () => {
    it('stops at six levels, the last operator shown without its operands', () => {
      const field = '!!!!!!!!input.x';
      const tree = explainOne(field, [
        [field, true],
        [at(field, '!!!input.x'), false],
      ]);
      expect(brief(tree)).toBe(
        'not ! = true [not ! [not ! [not ! [not ! [other = false]]]]]',
      );
      let deepest = tree;
      while (deepest.children.length > 0) deepest = deepest.children[0];
      expect(deepest).toMatchObject({
        source: '!!!input.x',
        evaluated: true,
        children: [],
      });
      expect(deepest.op).toBeUndefined();
    });

    it("keeps a reference's kind at the last level, its output dropped", () => {
      expect(
        brief(
          explainOne('!!!!!nodes.a.output.x', [
            ['!!!!!nodes.a.output.x', false],
            ['nodes.a.output.x', 1],
          ]),
        ),
      ).toBe(
        'not ! = false [not ! [not ! [not ! [not ! [ref nodes.a.output.x = 1]]]]]',
      );
    });

    it('lays out at most 32 nodes, all of an operator’s operands or none', () => {
      const chainOf = (prefix: string, n: number): string =>
        Array.from({ length: n }, (_, i) => `input.${prefix}${i}`).join(' && ');
      const fits = explainOne(chainOf('a', EXPLAIN_MAX_NODES - 1));
      expect(fits.children).toHaveLength(EXPLAIN_MAX_NODES - 1);
      expect(countNodes(fits)).toBe(EXPLAIN_MAX_NODES);

      const field = chainOf('a', EXPLAIN_MAX_NODES);
      const over = explainOne(field, [[field, true]]);
      expect(over).toEqual({
        range: [0, field.length],
        source: field.slice(0, EXPLAIN_SOURCE_LENGTH - 1) + '…',
        kind: 'other',
        value: summaryOf(true),
        evaluated: true,
        children: [],
      });
    });

    it('fills level by level, so a later sibling is summarized rather than a parent', () => {
      const chainOf = (prefix: string): string =>
        Array.from({ length: 20 }, (_, i) => `input.${prefix}${i}`).join(
          ' && ',
        );
      const field = `(${chainOf('a')}) || (${chainOf('b')})`;
      const tree = explainOne(field);
      expect(tree.kind).toBe('logical');
      expect(tree.children[0].kind).toBe('logical');
      expect(tree.children[0].children).toHaveLength(20);
      expect(tree.children[1]).toMatchObject({
        kind: 'other',
        source: chainOf('b').slice(0, EXPLAIN_SOURCE_LENGTH - 1) + '…',
        children: [],
      });
      expect(tree.children[1].op).toBeUndefined();
      expect(countNodes(tree)).toBe(23);
    });

    it('cuts a long source to 200 characters, never inside a character', () => {
      // The emoji's first half would be the 199th character kept.
      const head = "input.s === '";
      const text = `${'a'.repeat(EXPLAIN_SOURCE_LENGTH - 2 - head.length)}😀${'b'.repeat(50)}`;
      const field = `${head}${text}'`;
      const tree = explainOne(field);
      expect(tree.source).toBe(`${field.slice(0, EXPLAIN_SOURCE_LENGTH - 2)}…`);
      expect(tree.source.length).toBeLessThanOrEqual(EXPLAIN_SOURCE_LENGTH);
      expect(tree.children[1].source).toHaveLength(EXPLAIN_SOURCE_LENGTH);
      expect(tree.children[1].source.endsWith('…')).toBe(true);
      expect(tree.children[1].value).toEqual(summaryOf(text));
    });
  });

  it('stays browser-safe: no node builtins, Ajv or runner, transitively', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const visited = new Set<string>();
    const packages = new Set<string>();
    const visit = (file: string): void => {
      if (visited.has(file)) return;
      visited.add(file);
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(
        /^import\s+(?!type\b)[^'"]*?from\s+'([^']+)'/gm,
      )) {
        const specifier = match[1];
        if (specifier.startsWith('.')) {
          visit(path.resolve(path.dirname(file), `${specifier}.ts`));
        } else {
          packages.add(specifier);
        }
      }
    };
    visit(path.join(here, 'explain.ts'));
    expect(visited.size).toBeGreaterThan(3);
    expect(
      [...packages].filter(
        (name) =>
          name === 'ajv' ||
          name === 'bun' ||
          name.startsWith('node:') ||
          name.startsWith('convex'),
      ),
    ).toEqual([]);
    expect(
      [...visited].filter((file) =>
        /[/\\](runner|template|runners[/\\].*)\.ts$/.test(file),
      ),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The property: over seeded conditions and scopes, evaluated by a reference
// evaluator that notes every sub-expression that ran to a value, and a
// random share of those values kept as probes, the tree never calls a
// sub-expression evaluated that did not run, shows a value exactly where a
// probe was kept, and stays within its bounds.
// ---------------------------------------------------------------------------

const SHORT_CIRCUIT = Symbol('short-circuit');

const GLOBALS: Record<string, unknown> = {
  Object,
  Array,
  String,
  undefined,
};

/* oxlint-disable typescript/no-unsafe-type-assertion -- JavaScript's own operators over whatever the scope holds are the point */
const BINARY: Record<string, (a: unknown, b: unknown) => unknown> = {
  '>': (a, b) => (a as number) > (b as number),
  '<': (a, b) => (a as number) < (b as number),
  '>=': (a, b) => (a as number) >= (b as number),
  '===': (a, b) => a === b,
  '!==': (a, b) => a !== b,
  '+': (a, b) => (a as number) + (b as number),
};
/* oxlint-enable typescript/no-unsafe-type-assertion */

function rangeKey(node: Node): string {
  const [start, end] = node.range ?? [0, 0];
  return `${start}:${end}`;
}

/** Evaluate `root` as JavaScript would over `scope`, noting by range each
 * sub-expression that ran to a value; throws where it would. */
function evaluate(
  root: Node,
  scope: Record<string, unknown>,
  ran: Map<string, unknown>,
): unknown {
  const done = (node: Node, value: unknown): unknown => {
    ran.set(rangeKey(node), value);
    return value;
  };
  const read = (object: unknown, key: unknown): unknown => {
    if (object === null || object === undefined) {
      throw new TypeError(`Cannot read properties of ${String(object)}`);
    }
    const boxed: object = Object(object);
    return Reflect.get(boxed, String(key));
  };
  const keyOf = (member: MemberExpression): unknown =>
    member.computed
      ? value(member.property)
      : member.property.type === 'Identifier'
        ? member.property.name
        : undefined;
  // A member or call inside an optional chain: SHORT_CIRCUIT when a `?.`
  // found nothing.
  const link = (node: Node): unknown => {
    if (node.type === 'MemberExpression') {
      const object = link(node.object);
      if (object === SHORT_CIRCUIT) return SHORT_CIRCUIT;
      if (node.optional && (object === null || object === undefined)) {
        return SHORT_CIRCUIT;
      }
      return done(node, read(object, keyOf(node)));
    }
    if (node.type === 'CallExpression') {
      let self: unknown;
      let fn: unknown;
      if (node.callee.type === 'MemberExpression') {
        const object = link(node.callee.object);
        if (object === SHORT_CIRCUIT) return SHORT_CIRCUIT;
        if (node.callee.optional && (object === null || object === undefined)) {
          return SHORT_CIRCUIT;
        }
        self = object;
        fn = read(object, keyOf(node.callee));
      } else {
        fn = link(node.callee);
        if (fn === SHORT_CIRCUIT) return SHORT_CIRCUIT;
      }
      if (node.optional && (fn === null || fn === undefined)) {
        return SHORT_CIRCUIT;
      }
      const args = node.arguments.map((arg) => value(arg));
      if (typeof fn !== 'function') throw new TypeError('not a function');
      return done(node, Reflect.apply(fn, self, args));
    }
    return value(node);
  };
  const value = (node: Node): unknown => {
    switch (node.type) {
      case 'Literal':
        return done(node, node.value);
      case 'Identifier':
        if (Object.hasOwn(scope, node.name)) {
          return done(node, scope[node.name]);
        }
        if (Object.hasOwn(GLOBALS, node.name)) return GLOBALS[node.name];
        throw new ReferenceError(`${node.name} is not defined`);
      case 'ArrayExpression':
        return done(
          node,
          node.elements.map((element) =>
            element === null ? undefined : value(element),
          ),
        );
      case 'ObjectExpression':
        return done(node, {});
      case 'ChainExpression': {
        const out = link(node.expression);
        return done(node, out === SHORT_CIRCUIT ? undefined : out);
      }
      case 'MemberExpression':
      case 'CallExpression': {
        const out = link(node);
        if (out === SHORT_CIRCUIT) throw new Error('`?.` outside a chain');
        return out;
      }
      case 'UnaryExpression': {
        const operand = value(node.argument);
        if (node.operator === '!') return done(node, !operand);
        if (node.operator === '-') return done(node, -Number(operand));
        if (node.operator === 'typeof') return done(node, typeof operand);
        throw new Error(`no unary ${node.operator}`);
      }
      case 'BinaryExpression': {
        const left = value(node.left);
        const right = value(node.right);
        return done(node, BINARY[node.operator](left, right));
      }
      case 'LogicalExpression': {
        const left = value(node.left);
        const stop =
          node.operator === '&&'
            ? !left
            : node.operator === '||'
              ? Boolean(left)
              : left !== null && left !== undefined;
        return done(node, stop ? left : value(node.right));
      }
      case 'ConditionalExpression':
        return done(
          node,
          value(node.test) ? value(node.consequent) : value(node.alternate),
        );
      default:
        throw new Error(`the generator writes no ${node.type}`);
    }
  };
  return value(root);
}

function pick<T>(random: Random, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)];
}

const REFS = [
  'input.a',
  'input.b',
  'input.items',
  'input.items.length',
  'input.user.name',
  'input.items[0]',
  'input.items[index]',
  "input['a']",
  'input?.user?.name',
  'nodes.fetch.output',
  'nodes.fetch.output.items',
  'nodes.fetch.output.items.length',
  'nodes.fetch?.output?.items',
  'nodes.fetch?.output?.total',
  'item',
  'item.name',
  'index',
  'output.done',
];

const LITERALS = [
  '0',
  '1',
  '10',
  "'open'",
  'true',
  'false',
  'null',
  'undefined',
  "['open', 'done']",
  '-1',
];

function conditionOf(random: Random, depth: number): string {
  if (depth <= 0 || random() < 0.25) {
    return random() < 0.65 ? pick(random, REFS) : pick(random, LITERALS);
  }
  const sub = (): string => `(${conditionOf(random, depth - 1)})`;
  switch (Math.floor(random() * 13)) {
    case 0:
      return `${sub()} && ${sub()} && ${sub()}`;
    case 1:
      return `${sub()} || ${sub()}`;
    case 2:
      return `${sub()} ?? ${sub()}`;
    case 3:
      return `${sub()} ${pick(random, ['>', '<', '>=', '===', '!=='])} ${sub()}`;
    case 4:
      return `!${sub()}`;
    case 5:
      return `${sub()} ? ${sub()} : ${sub()}`;
    case 6:
      return `${sub()}.length`;
    case 7:
      return `${pick(random, REFS)}${random() < 0.5 ? '?.' : '.'}includes(${sub()})`;
    case 8:
      return `Object.keys(${sub()} ?? {}).length`;
    case 9:
      return `Array.isArray(${sub()})`;
    case 10:
      return `String(${sub()}).startsWith('o')`;
    case 11:
      return `typeof ${sub()}`;
    default:
      return `${sub()} + ${sub()}`;
  }
}

function scopeOf(random: Random): Record<string, unknown> {
  const list = (): unknown[] =>
    Array.from({ length: Math.floor(random() * 4) }, () =>
      randomJson(random, 1),
    );
  return {
    input: {
      a: randomJson(random, 2),
      b: randomJson(random, 2),
      ...(random() < 0.8 && { items: list() }),
      user: random() < 0.3 ? null : { name: pick(random, ['open', 'Ada']) },
    },
    nodes:
      random() < 0.25
        ? {}
        : {
            fetch: {
              output:
                random() < 0.2
                  ? null
                  : { items: list(), total: Math.floor(random() * 20) },
            },
          },
    item: randomJson(random, 2),
    index: Math.floor(random() * 3),
    output: { done: random() < 0.5 },
  };
}

describe('explainCondition, over seeded conditions and scopes', () => {
  it('vouches only for what ran, shows exactly the kept values, and stays in bounds', () => {
    const random = seeded(20_261_009);
    const kinds = new Set<string>();
    let summarized = 0;
    let unevaluated = 0;
    for (let round = 0; round < 400; round++) {
      const field = conditionOf(random, 2 + Math.floor(random() * 3));
      const scope = scopeOf(random);
      const parsed = parseExpressionIn(field, 0, field.length);
      const ran = new Map<string, unknown>();
      let threw: string | undefined;
      if (parsed.ok) {
        try {
          evaluate(parsed.ast, scope, ran);
        } catch (error) {
          // A failing condition keeps the values taken before it failed,
          // and its unit says it failed.
          if (!(error instanceof TypeError)) throw error;
          threw = error.message;
        }
      }
      const kept = [...ran].filter(() => random() < 0.7);
      const probes: EvalUnitTrace['probes'] = kept.map(([key, v]) => {
        const [start, end] = key.split(':').map(Number);
        return { range: [start, end], v: summaryOf(v) };
      });
      const trace = traceOf([
        {
          range: [0, field.length],
          probes,
          probed: 'full',
          ...(threw !== undefined && { error: { message: threw } }),
        },
      ]);
      const [tree] = explainCondition(field, trace);
      const probeAt = new Map(
        probes.map((probe) => [`${probe.range[0]}:${probe.range[1]}`, probe.v]),
      );

      if (!parsed.ok) {
        expect(tree).toMatchObject({ kind: 'other', children: [] });
        continue;
      }
      let count = 0;
      const check = (
        node: ExplainNode,
        depth: number,
        within: [number, number],
      ): void => {
        count++;
        kinds.add(node.kind);
        const key = `${node.range[0]}:${node.range[1]}`;
        const text = field.slice(node.range[0], node.range[1]);
        expect(depth).toBeLessThanOrEqual(EXPLAIN_MAX_DEPTH);
        expect(node.range[0]).toBeGreaterThanOrEqual(within[0]);
        expect(node.range[1]).toBeLessThanOrEqual(within[1]);
        expect(node.source).toBe(
          text.length <= EXPLAIN_SOURCE_LENGTH
            ? text
            : `${text.slice(0, EXPLAIN_SOURCE_LENGTH - 1)}…`,
        );
        expect(node.ref !== undefined).toBe(node.kind === 'ref');
        if (node.kind !== 'literal') {
          expect(node.value, `${field} @ ${node.source}`).toEqual(
            probeAt.get(key),
          );
          if (node.evaluated) {
            expect(ran.has(key), `${field} @ ${node.source}`).toBe(true);
          } else {
            unevaluated++;
          }
        }
        if (
          ['logical', 'compare', 'not', 'arith', 'conditional'].includes(
            node.kind,
          )
        ) {
          expect(node.children.length).toBeGreaterThan(0);
        }
        if (node.kind === 'other' && node.op === undefined && depth > 1) {
          summarized++;
        }
        let from = node.range[0];
        for (const child of node.children) {
          expect(child.range[0]).toBeGreaterThanOrEqual(from);
          from = child.range[1];
          check(child, depth + 1, node.range);
        }
      };
      check(tree, 1, [0, field.length]);
      expect(count).toBeLessThanOrEqual(EXPLAIN_MAX_NODES);
      expect(explainCondition(field, trace)).toEqual([tree]);
    }
    // The generator reaches every kind the tree has, short circuits and
    // the bounds.
    expect([...kinds].toSorted()).toEqual(
      [
        'arith',
        'call',
        'compare',
        'conditional',
        'literal',
        'logical',
        'not',
        'other',
        'ref',
      ].toSorted(),
    );
    expect(unevaluated).toBeGreaterThan(0);
    expect(summarized).toBeGreaterThan(0);
  });
});

describe('explainCondition, over what a real run recorded', () => {
  beforeAll(() => {
    setCodeRunner(nodeVmRunner());
  });

  it('draws every probe the run kept, the part before a `?.` included', async () => {
    const field = 'input.order?.items.length > 0';
    const { trace } = await evalConditionTraced(
      field,
      { input: { order: { items: [] } } },
      '/nodes/0/when',
    );
    const [tree] = explainCondition(field, trace);
    const drawn = new Set<string>();
    const visit = (node: ExplainNode): void => {
      drawn.add(`${node.range[0]}:${node.range[1]}`);
      node.children.forEach(visit);
    };
    if (tree !== undefined) visit(tree);
    for (const probe of trace.units[0]?.probes ?? []) {
      expect(drawn, field.slice(...probe.range)).toContain(
        `${probe.range[0]}:${probe.range[1]}`,
      );
    }
    expect(brief(tree as ExplainNode)).toContain('compare > = false');
  });

  it('vouches for nothing after a `?.` whose value was withheld', async () => {
    const field = "input.creds?.apiKey.startsWith('sk')";
    const { trace } = await evalConditionTraced(
      field,
      { input: { creds: { apiKey: 'sk-abcdefghijklmnopqrstu' } } },
      '/nodes/0/when',
    );
    const [tree] = explainCondition(field, trace);
    const literal = tree?.children.find((child) => child.kind === 'literal');
    expect(literal?.evaluated).toBe(true);
    expect(JSON.stringify(tree)).not.toContain('abcdefghij');
  });
});

describe('explainCondition, when the probes cannot tell', () => {
  it('reads a part without a probe as unknown, not as skipped, when probing was capped', () => {
    const field = 'input.a > 0 || input.b > 0';
    const [tree] = explainCondition(
      field,
      traceOf([
        {
          range: [0, field.length],
          probes: [{ range: [0, field.length], v: summaryOf(true) }],
          probed: 'partial',
        },
      ]),
    );
    const right = tree?.children[1];
    expect(right).toMatchObject({ evaluated: false, unknown: true });
  });

  it('never throws on a trace that does not read', () => {
    expect(
      explainCondition('input.a', { pointer: '', units: 'x' } as never),
    ).toEqual([]);
    expect(
      explainCondition('input.a', {
        pointer: '',
        units: [
          { range: [0, 7], probes: [{ range: 'x', v: 1 }], probed: 'full' },
          { range: 'nope' },
          null,
        ],
      } as never),
    ).toHaveLength(3);
  });

  it('holds operators and reference keys to the source length', () => {
    const key = 'k'.repeat(400);
    const field = `input.${key} > 1`;
    const [tree] = explainCondition(
      field,
      traceOf([{ range: [0, field.length], probes: [], probed: 'full' }]),
    );
    const ref = tree?.children[0]?.ref;
    expect(String(ref?.path[0]).length).toBeLessThanOrEqual(
      EXPLAIN_SOURCE_LENGTH,
    );
  });
});
