// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { parseBody, parseExpressionIn } from './parse';
import { collectRefs, looseNodeRefs, SCOPE_ROOTS, type RefSite } from './walk';

const TEMPLATE_ROOTS = new Set(['input', 'nodes']);

function refsIn(
  expr: string,
  roots: ReadonlySet<string> = TEMPLATE_ROOTS,
): RefSite[] {
  const parsed = parseExpressionIn(expr, 0, expr.length);
  if (!parsed.ok) throw new Error(parsed.message);
  return collectRefs(parsed.ast, { roots });
}

function refsInBody(code: string): RefSite[] {
  const parsed = parseBody(code);
  if (!parsed.ok) throw new Error(parsed.message);
  return collectRefs(parsed.ast, { roots: SCOPE_ROOTS });
}

const nodeIds = (sites: RefSite[]) =>
  sites.filter((s) => s.root === 'nodes').map((s) => s.nodeId);

describe('collectRefs — only real references', () => {
  it('reads the static spellings of a node reference', () => {
    const sites = refsIn(
      'nodes.a.output + nodes[\'b-2\'].output + nodes["c"].output + nodes[`d`].output',
    );
    expect(nodeIds(sites)).toEqual(['a', 'b-2', 'c', 'd']);
    expect(sites.every((s) => s.member === 'output')).toBe(true);
  });

  it('ignores comments and string contents', () => {
    expect(refsIn("'nodes.a.output' + /* nodes.b */ input.x")).toEqual([
      expect.objectContaining({
        root: 'input',
        path: [expect.objectContaining({ key: 'x' })],
      }),
    ]);
  });

  it('ignores locals that shadow a scope name', () => {
    const code = [
      'const nodes = [1, 2];',
      'const n = nodes.length;',
      'const ids = input.items.map((item) => item.id);',
      'function output() { return 1; }',
      'try { output(); } catch (output) { return output; }',
      'return n + ids.length;',
    ].join('\n');
    const sites = refsInBody(code);
    expect(sites.map((s) => `${s.root}:${s.name}`)).toEqual(['input:input']);
  });

  it('a function declared later still shadows (hoisting)', () => {
    expect(
      refsInBody('return input(); function input() { return 1; }'),
    ).toEqual([]);
  });

  it('property keys and member names are not references', () => {
    const sites = refsIn('({ nodes: 1, input: 2 }).nodes + input.nodes');
    expect(sites.map((s) => s.root)).toEqual(['input']);
  });

  it('marks dynamic access to nodes, which names no node', () => {
    for (const expr of [
      'nodes[input.k].output',
      '({ ...nodes })',
      'Object.keys(nodes)',
      'nodes',
    ]) {
      const site = refsIn(expr).find((s) => s.root === 'nodes');
      expect(site).toMatchObject({ dynamicNodeAccess: true });
      expect(site?.nodeId).toBeUndefined();
    }
  });

  it('reports undeclared names as free, and never a JavaScript global', () => {
    const sites = refsIn('Math.max(item, JSON.stringify(output), Date.now())');
    expect(sites.map((s) => `${s.root}:${s.name}`)).toEqual([
      'free:item',
      'free:output',
    ]);
    // In a scope that declares them they are roots, not free.
    expect(refsIn('item.id + index', SCOPE_ROOTS).map((s) => s.root)).toEqual([
      'item',
      'index',
    ]);
  });

  it('reads the member chain, its optional steps and whether it is called', () => {
    const [site] = refsIn('nodes.a?.output.items?.[0].name.trim()');
    expect(site).toMatchObject({
      nodeId: 'a',
      member: 'output',
      called: true,
      path: [
        { key: 'items', optional: false, computed: false },
        { key: 0, optional: true, computed: true },
        { key: 'name', optional: false, computed: false },
        { key: 'trim', optional: false, computed: false },
      ],
    });
    expect(site.guards).toContain('optional-chain');
  });

  it('stops the chain at a computed member it cannot name', () => {
    const [site] = refsIn('nodes.a.output[input.k].x');
    expect(site).toMatchObject({
      nodeId: 'a',
      member: 'output',
      path: [],
      dynamicTail: true,
    });
    const [bare] = refsIn('nodes.a[input.k]');
    expect(bare).toMatchObject({ nodeId: 'a', dynamicTail: true });
    expect(bare.member).toBeUndefined();
  });

  it('ranges are exact offsets of the member chain', () => {
    const expr = 'x + nodes.fetch.output.items.length';
    const parsed = parseExpressionIn(`{{ ${expr} }}`, 3, 3 + expr.length);
    if (!parsed.ok) throw new Error(parsed.message);
    const site = collectRefs(parsed.ast, { roots: TEMPLATE_ROOTS }).find(
      (s) => s.root === 'nodes',
    );
    expect(site?.range).toEqual([7, 38]);
    expect(`{{ ${expr} }}`.slice(...(site?.range ?? [0, 0]))).toBe(
      'nodes.fetch.output.items.length',
    );
  });
});

describe('collectRefs — guards', () => {
  const guardsOf = (expr: string, nodeId = 'a') =>
    refsIn(expr)
      .filter((s) => s.nodeId === nodeId)
      .map((s) => s.guards);

  it.each([
    ['nodes.a.output?.x', 'optional-chain'],
    ['nodes.a.output.x ?? 0', 'nullish-left'],
    ['nodes.a.output.items.length || 0', 'or-left'],
    ['typeof nodes.a.output', 'typeof'],
  ] as const)('%s → %s', (expr, guard) => {
    expect(guardsOf(expr)[0]).toContain(guard);
  });

  it('and-guarded: the left operand reads the same output', () => {
    const [left, right] = guardsOf('nodes.a.output && nodes.a.output.x');
    expect(left).toEqual([]);
    expect(right).toEqual(['and-guarded']);
    // A different node on the left guards nothing.
    expect(refsIn('nodes.b.output && nodes.a.output.x')[1].guards).toEqual([]);
  });

  it('ternary-guarded: the test reads the same output', () => {
    const [, consequent, alternate] = guardsOf(
      'nodes.a.output ? nodes.a.output.x : nodes.a.output',
    );
    expect(consequent).toEqual(['ternary-guarded']);
    expect(alternate).toEqual([]);
  });

  it('an input prefix guards a longer input read', () => {
    const sites = refsIn('input.a && input.a.b.c');
    expect(sites[1].guards).toEqual(['and-guarded']);
  });

  it('a guard outside a function body does not guard a read inside it', () => {
    const sites = refsIn('xs.map(() => nodes.a.output.x) ?? []');
    expect(sites.find((s) => s.nodeId === 'a')?.guards).toEqual([]);
    // The call's own result is still the left operand of `??`.
    expect(sites.find((s) => s.name === 'xs')?.guards).toEqual([
      'nullish-left',
    ]);
  });

  it('typeof only guards the operand itself', () => {
    expect(refsIn('typeof item', SCOPE_ROOTS)[0].guards).toEqual(['typeof']);
    expect(refsIn('typeof (item + 1)', SCOPE_ROOTS)[0].guards).toEqual([]);
  });
});

describe('looseNodeRefs — draft text that does not parse', () => {
  it('finds node references token by token, skipping strings and members', () => {
    const text = "{{ nodes.a.output + 'nodes.b' + x.nodes.c + nodes['d'] + }}";
    const sites = looseNodeRefs(text, 3, text.length - 3);
    expect(sites.map((s) => s.nodeId)).toEqual(['a', 'd']);
    expect(text.slice(...sites[0].range)).toBe('nodes.a');
  });

  it('keeps what it read before the text stops tokenizing', () => {
    const text = 'nodes.a.output + "unterminated';
    expect(looseNodeRefs(text, 0, text.length).map((s) => s.nodeId)).toEqual([
      'a',
    ]);
  });
});
