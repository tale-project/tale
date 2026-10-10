// @vitest-environment node

import { describe, expect, it } from 'vitest';

import type { NodeDef } from '../types';
import { newParseCtx, outputSources, refSitesOf, sourcesOf } from './sources';

describe('sourcesOf — the one enumeration', () => {
  it('lists every field in reading order, with RFC 6901 pointers', () => {
    const node: NodeDef = {
      id: 'draft',
      type: 'agent',
      input: {
        'a/b': '{{ input.x }}',
        'c~d': ['plain', '{{ nodes.prep.output }}'],
        n: 42,
      },
      prompt: 'Use {{ nodes.prep.output.text }}',
      system: 'no templates here',
      files: { setup: '{{ nodes.prep.output.folder }}' },
      when: 'input.go',
      repeatUntil: '{{ output.done }}',
    };
    const sources = sourcesOf(node, 3);
    expect(sources.map((s) => [s.field, s.pointer, s.kind, s.data])).toEqual([
      ['input', '/nodes/3/input/a~1b', 'template', true],
      ['input', '/nodes/3/input/c~0d/1', 'template', true],
      ['prompt', '/nodes/3/prompt', 'template', true],
      ['files', '/nodes/3/files/setup', 'template', true],
      ['when', '/nodes/3/when', 'condition', false],
      ['repeatUntil', '/nodes/3/repeatUntil', 'condition', false],
    ]);
    expect(
      sources.every((s) => s.nodeId === 'draft' && s.nodeIndex === 3),
    ).toBe(true);
  });

  it('reads a condition as one bare expression when it has no braces', () => {
    const [bare] = sourcesOf({
      id: 'a',
      type: 'transform',
      when: '  input.go  ',
    });
    expect(bare.tokens).toBeUndefined();
    expect(bare.units.map((u) => [u.source, u.range])).toEqual([
      ['input.go', [2, 10]],
    ]);
    const [tpl] = sourcesOf({
      id: 'a',
      type: 'transform',
      when: '{{ input.go }}',
    });
    expect(tpl.units.map((u) => u.source)).toEqual(['input.go']);
  });

  it('a forEach without braces is text, not an expression', () => {
    expect(
      sourcesOf({ id: 'a', type: 'transform', forEach: 'input.items' }),
    ).toEqual([]);
    const [each] = sourcesOf({
      id: 'a',
      type: 'transform',
      forEach: '{{ input.items }}',
    });
    expect(each).toMatchObject({ field: 'forEach', data: true });
  });

  it('transform code is one body unit in the code scope', () => {
    const [code] = sourcesOf(
      { id: 'a', type: 'transform', code: 'return item ?? nodes.b.output;' },
      0,
    );
    expect(code).toMatchObject({
      field: 'code',
      kind: 'body',
      pointer: '/nodes/0/code',
    });
    expect(code.units[0].refs.map((r) => r.root)).toEqual(['item', 'nodes']);
  });

  it('without an index the pointers are relative to the node', () => {
    const [source] = sourcesOf({
      id: 'a',
      type: 'llm',
      prompt: '{{ input.x }}',
    });
    expect(source.pointer).toBe('/prompt');
    expect(source.nodeIndex).toBeUndefined();
  });

  it('an unparseable unit keeps the references a token scan finds', () => {
    const [source] = sourcesOf({
      id: 'a',
      type: 'llm',
      prompt: '{{ nodes.b.output + }}',
    });
    expect(source.units[0].parse.ok).toBe(false);
    expect(source.units[0].refs.map((r) => r.nodeId)).toEqual(['b']);
  });

  it('a parse memo shares the work across identical text', () => {
    const ctx = newParseCtx();
    const a = sourcesOf(
      { id: 'a', type: 'llm', prompt: '{{ input.x }}' },
      0,
      ctx,
    );
    const b = sourcesOf(
      { id: 'b', type: 'llm', prompt: '{{ input.x }}' },
      1,
      ctx,
    );
    expect(a[0].units).toBe(b[0].units);
    expect(a[0].pointer).not.toBe(b[0].pointer);
  });
});

describe('outputSources / refSitesOf', () => {
  it('walks the document output', () => {
    const sources = outputSources({
      summary: '{{ nodes.a.output.text }}',
      list: ['{{ nodes.b.output ?? [] }}'],
      fixed: 'done',
    });
    expect(sources.map((s) => [s.pointer, s.field, s.data])).toEqual([
      ['/output/summary', 'output', false],
      ['/output/list/0', 'output', false],
    ]);
    expect(outputSources('{{ nodes.a.output }}')[0].pointer).toBe('/output');
  });

  it('pairs each site with its source and unit', () => {
    const sites = refSitesOf(
      {
        id: 'c',
        type: 'llm',
        prompt: 'A {{ nodes.a.output }} B {{ nodes.b.output }}',
      },
      2,
    );
    expect(
      sites.map((s) => [s.site.nodeId, s.source.pointer, s.unit.source]),
    ).toEqual([
      ['a', '/nodes/2/prompt', 'nodes.a.output'],
      ['b', '/nodes/2/prompt', 'nodes.b.output'],
    ]);
  });
});
