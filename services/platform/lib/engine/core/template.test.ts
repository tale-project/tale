import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { nodeVmRunner } from '../runners/node-vm';
import { setCodeRunner } from './runner';
import {
  evalCondition,
  evalConditionTraced,
  evalTemplates,
  evalTemplateTraced,
  ExprError,
  runCode,
} from './template';

beforeEach(() => {
  setCodeRunner(nodeVmRunner());
});

afterEach(() => {
  // Later suites must install their own runner deliberately.
});

describe('evalTemplates — the two authoring rules', () => {
  const scope = {
    input: { n: 7, name: 'Ada' },
    nodes: { first: { output: { id: 'abc', list: [1, 2] } } },
  };

  it('a field that is exactly one template keeps the expression type', async () => {
    await expect(evalTemplates('{{ input.n }}', scope)).resolves.toBe(7);
    await expect(
      evalTemplates('{{ nodes.first.output.list }}', scope),
    ).resolves.toEqual([1, 2]);
  });

  it('mixed text interpolates, objects as JSON', async () => {
    await expect(
      evalTemplates('id={{ nodes.first.output.id }}!', scope),
    ).resolves.toBe('id=abc!');
    await expect(
      evalTemplates('l: {{ nodes.first.output.list }}', scope),
    ).resolves.toBe('l: [1,2]');
  });

  it('interpolating null/undefined into a string is an error with guidance', async () => {
    await expect(
      evalTemplates('temp: {{ input.missing }}', scope),
    ).rejects.toThrow(/does not exist.*Check the exact output shape/s);
  });

  it('walks arrays and objects', async () => {
    await expect(
      evalTemplates({ a: ['{{ input.n }}'], b: 'x{{ input.n }}' }, scope),
    ).resolves.toEqual({ a: [7], b: 'x7' });
  });

  it('a "}}" inside the expression does not end the template', async () => {
    await expect(
      evalTemplates("{{ {name: input.name, tag: '}}'} }}", scope),
    ).resolves.toEqual({ name: 'Ada', tag: '}}' });
    await expect(
      evalTemplates('{{ nodes.first.output.list.map(x => ({v: x})) }}', scope),
    ).resolves.toEqual([{ v: 1 }, { v: 2 }]);
    await expect(
      evalTemplates("tag={{ '}}' + input.n }}!", scope),
    ).resolves.toBe('tag=}}7!');
  });

  it('keeps what the first "}}" rule produced whenever that parsed', async () => {
    // A third brace after a complete expression stays text, as before.
    await expect(evalTemplates('{{ input.n }}}', scope)).resolves.toBe('7}');
    // No closer at all: the braces are plain text.
    await expect(evalTemplates('{{ input.n }', scope)).resolves.toBe(
      '{{ input.n }',
    );
    await expect(evalTemplates('{{}}', scope)).resolves.toBe('{{}}');
  });

  it('wraps evaluation failures as ExprError naming the expression', async () => {
    await expect(
      evalTemplates('{{ input.n.f() }}', scope),
    ).rejects.toBeInstanceOf(ExprError);
  });
});

describe('evalCondition', () => {
  it('accepts bare expressions and template form alike', async () => {
    const scope = { input: { ok: true } };
    await expect(evalCondition('input.ok', scope)).resolves.toBe(true);
    await expect(evalCondition('{{ !input.ok }}', scope)).resolves.toBe(false);
  });
});

describe('the scope handed to the runner', () => {
  let seen: Record<string, unknown> | undefined;
  const scope = {
    input: { n: 1 },
    nodes: { a: { output: 1 }, b: { output: 2 }, c: { output: 3 } },
    item: 'i',
  };

  beforeEach(() => {
    seen = undefined;
    setCodeRunner({
      async evalExpr(_expr, s) {
        seen = s;
        return 1;
      },
      async runBody(_code, s) {
        seen = s;
        return 1;
      },
      async checkExpr() {
        return null;
      },
      async checkBody() {
        return null;
      },
      kind: () => 'recording',
    });
  });

  it('carries only the nodes the expression names, and everything else whole', async () => {
    await evalTemplates('{{ nodes.a.output + nodes["b"].output }}', scope);
    expect(seen).toEqual({
      input: { n: 1 },
      nodes: { a: { output: 1 }, b: { output: 2 } },
      item: 'i',
    });
  });

  it('keeps every node when `nodes` is used any other way', async () => {
    await evalTemplates(
      '{{ (() => { const id = "c"; return nodes[id].output; })() }}',
      scope,
    );
    expect(Object.keys(seen?.nodes ?? {})).toEqual(['a', 'b', 'c']);
    await evalTemplates('{{ Object.keys(nodes).length }}', scope);
    expect(Object.keys(seen?.nodes ?? {})).toEqual(['a', 'b', 'c']);
  });

  it('each expression of one string gets its own', async () => {
    await evalTemplates('{{ nodes.a.output }} and {{ nodes.c.output }}', scope);
    expect(Object.keys(seen?.nodes ?? {})).toEqual(['c']);
  });

  it('a name in a comment, a string or a shadowing local is no reference', async () => {
    await evalTemplates(
      "{{ 'nodes.c' + nodes.a.output /* nodes.b */ }}",
      scope,
    );
    expect(Object.keys(seen?.nodes ?? {})).toEqual(['a']);
    await runCode(
      '// nodes.b is unused\nconst pick = (nodes) => nodes.c;\nreturn nodes.a.output;',
      scope,
    );
    expect(Object.keys(seen?.nodes ?? {})).toEqual(['a']);
  });

  it('keeps every node when the source does not parse or reaches the scope indirectly', async () => {
    await evalTemplates('{{ nodes.a.output + }}', scope);
    expect(Object.keys(seen?.nodes ?? {})).toEqual(['a', 'b', 'c']);
    await evalTemplates('{{ arguments[1].c.output }}', scope);
    expect(Object.keys(seen?.nodes ?? {})).toEqual(['a', 'b', 'c']);
  });

  it('conditions and transform bodies are pruned the same way', async () => {
    await evalCondition('nodes.b.output === 2', scope);
    expect(Object.keys(seen?.nodes ?? {})).toEqual(['b']);
    await runCode('return nodes.c.output;', scope);
    expect(Object.keys(seen?.nodes ?? {})).toEqual(['c']);
  });
});

describe('runCode (transform bodies)', () => {
  it('runs a body with input in scope and returns its value', async () => {
    await expect(
      runCode('return input.a + input.b;', { input: { a: 2, b: 3 } }),
    ).resolves.toBe(5);
  });

  it('undefined result surfaces as undefined (the missing-return signal)', async () => {
    await expect(
      runCode('const x = 1;', { input: {} }),
    ).resolves.toBeUndefined();
  });
});

describe('a failure says why and where', () => {
  const scope = {
    input: { n: 7, list: [1] },
    nodes: { fetch: { output: { items: null } } },
  };

  async function failureOf(run: () => Promise<unknown>) {
    try {
      await run();
    } catch (error) {
      if (error instanceof ExprError) return error.failure;
      throw error;
    }
    throw new Error('expected a failure');
  }

  it('names the chain that held nothing, at the unit that read it', async () => {
    const field = 'Count: {{ nodes.fetch.output.items.length }}';
    expect(
      await failureOf(() => evalTemplates(field, scope, '/nodes/1/prompt')),
    ).toEqual({
      reason: 'EXPR_READ_MISSING',
      params: {
        field: 'prompt',
        expr: 'nodes.fetch.output.items.length',
        key: 'length',
        base: 'null',
        chain: 'nodes.fetch.output.items',
        source: 'fetch',
      },
      at: { pointer: '/nodes/1/prompt', range: [10, 41] },
    });
  });

  it('extends the pointer into a mapping', async () => {
    const failure = await failureOf(() =>
      evalTemplates({ q: ['x', '{{ nope }}'] }, scope, '/nodes/0/input'),
    );
    expect(failure?.reason).toBe('EXPR_NAME_UNKNOWN');
    expect(failure?.at).toEqual({
      pointer: '/nodes/0/input/q/1',
      range: [3, 7],
    });
  });

  it('says a value interpolated into text was missing', async () => {
    expect(
      await failureOf(() =>
        evalTemplates('n={{ input.gone }}', scope, '/output/text'),
      ),
    ).toEqual({
      reason: 'TEMPLATE_VALUE_MISSING',
      params: { field: 'output.text', expr: 'input.gone', base: 'undefined' },
      at: { pointer: '/output/text', range: [5, 15] },
    });
  });

  it('places a bare condition by its text, whitespace aside', async () => {
    const failure = await failureOf(() =>
      evalCondition('  nope > 1 ', scope, '/nodes/2/when'),
    );
    expect(failure?.at).toEqual({ pointer: '/nodes/2/when', range: [2, 10] });
  });

  it('keeps the message it always had', async () => {
    await expect(
      evalTemplates('n={{ input.gone }}', scope, '/output/text'),
    ).rejects.toThrow(/^template \{\{ input\.gone \}\} evaluated to undefined/);
  });

  it('reads a transform that threw', async () => {
    expect(
      await failureOf(() =>
        runCode('throw new TypeError("no")', scope, 1000, '/nodes/3/code'),
      ),
    ).toMatchObject({
      reason: 'CODE_FAILED',
      params: { detail: expect.stringContaining('no') },
      at: { pointer: '/nodes/3/code' },
    });
  });
});

describe('traced evaluation', () => {
  const scope = { input: { n: 7 } };

  it('answers the value evalCondition answers, with one unit per expression', async () => {
    await expect(
      evalConditionTraced(' input.n > 5 ', scope, '/nodes/0/when'),
    ).resolves.toEqual({
      value: true,
      trace: {
        pointer: '/nodes/0/when',
        units: [{ range: [1, 12], probes: [], probed: 'none' }],
      },
    });
    const forEach = await evalTemplateTraced(
      '{{ [input.n, 1] }}',
      scope,
      '/nodes/0/forEach',
    );
    expect(forEach.value).toEqual([7, 1]);
    expect(forEach.trace.units.map((u) => u.range)).toEqual([[3, 15]]);
  });

  it('throws when the plain evaluation would, carrying the trace', async () => {
    const error = await evalConditionTraced(
      '{{ input.n }} and {{ input.x.y }}',
      scope,
      '/nodes/0/when',
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExprError);
    const failure = (error as ExprError).failure;
    expect(failure?.trace?.units).toHaveLength(2);
    expect(failure?.trace?.units[1]?.error?.message).toMatch(/reading 'y'/);
    expect(failure?.trace?.units[0]?.error).toBeUndefined();
  });
});
