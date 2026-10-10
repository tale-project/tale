import { randomJson, seeded, type Random } from '@tale/ui/data/random-json';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { nodeVmRunner } from '../runners/node-vm';
import type { EvalUnitTrace } from './record/types';
import {
  type CodeRunner,
  codeRunner,
  RunnerStopped,
  setCodeRunner,
} from './runner';
import { parseExpressionIn } from './syntax/parse';
import { instrument, probePlan } from './syntax/probe';
import {
  evalCondition,
  evalConditionTraced,
  evalTemplates,
  evalTemplatesRendered,
  evalTemplateTraced,
  explainFailure,
  ExprError,
  RENDERED_SPANS_PER_FIELD,
  runCode,
} from './template';
import { configureTemplates } from './template-fast';

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
  // What the runner is handed: the fast path, which reads a plain path
  // without it, is off here.
  beforeEach(() => {
    configureTemplates({ fastPath: false });
  });
  afterEach(() => {
    configureTemplates({ fastPath: true });
  });

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
        units: [
          {
            range: [1, 12],
            probes: [
              { range: [1, 8], v: { kind: 'number', text: '7', bytes: 1 } },
              {
                range: [1, 12],
                v: { kind: 'boolean', text: 'true', bytes: 4 },
              },
            ],
            probed: 'full',
          },
        ],
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

/** Each probe of a unit as `source → summary`, in the order they fired. */
function probesOf(field: string, unit: EvalUnitTrace | undefined) {
  return (unit?.probes ?? []).map((p) => [field.slice(...p.range), p.v]);
}

/** What an evaluation settled to: its value, or its error's words and
 * cause (without the trace a traced evaluation adds). */
async function settled(run: () => Promise<unknown>) {
  try {
    return { value: await run() };
  } catch (error) {
    if (!(error instanceof ExprError)) throw error;
    const { trace: _trace, ...cause } = error.failure ?? {};
    return { message: error.message, expr: error.expr, cause };
  }
}

/** The node-vm runner with probing taken away, and counters on the rest. */
function runnerWith(
  overrides: Partial<CodeRunner>,
): CodeRunner & { plainCalls: () => number } {
  const base = nodeVmRunner();
  let plain = 0;
  return {
    evalExpr: async (expr, scope, limits) => {
      plain += 1;
      return await base.evalExpr(expr, scope, limits);
    },
    runBody: async (code, scope, limits, opts) =>
      await base.runBody(code, scope, limits, opts),
    checkExpr: async (expr) => await base.checkExpr(expr),
    checkBody: async (code, opts) => await base.checkBody(code, opts),
    kind: () => 'test',
    ...overrides,
    plainCalls: () => plain,
  };
}

describe('traced evaluation — what each sub-expression held', () => {
  const scope = {
    input: {
      n: 7,
      ok: false,
      list: [1, 2],
      apiKey: 'sk-abcdefghijklmnopqrstu',
      password: 'hunter2',
      note: 'see sk-abcdefghijklmnopqrstuvwx',
    },
    nodes: { fetch: { output: { items: null, total: 3 } } },
  };

  it('places every probe in the field, around the unit it belongs to', async () => {
    const field = '{{ input.list.length >= 2 }}';
    const { value, trace } = await evalConditionTraced(field, scope, '/w');
    expect(value).toBe(true);
    expect(trace.units[0]?.probed).toBe('full');
    expect(probesOf(field, trace.units[0])).toEqual([
      ['input.list.length', { kind: 'number', text: '2', bytes: 1 }],
      ['input.list.length >= 2', { kind: 'boolean', text: 'true', bytes: 4 }],
    ]);
  });

  it('a short-circuited operand has no probe', async () => {
    const field = 'input.ok && input.n > 1';
    const { value, trace } = await evalConditionTraced(field, scope, '/w');
    expect(value).toBe(false);
    expect(probesOf(field, trace.units[0]).map(([source]) => source)).toEqual([
      'input.ok',
      'input.ok && input.n > 1',
    ]);
  });

  it('probes each unit of mixed text on its own', async () => {
    const field = 'a {{ input.n }} b {{ nodes.fetch.output.total * 2 }}';
    const { value, trace } = await evalTemplateTraced(field, scope, '/x');
    expect(value).toBe('a 7 b 6');
    expect(trace.units.map((u) => u.probed)).toEqual(['full', 'full']);
    expect(probesOf(field, trace.units[1]).map(([source]) => source)).toEqual([
      'nodes.fetch.output',
      'nodes.fetch.output.total',
      'nodes.fetch.output.total * 2',
    ]);
  });

  it('withholds secrets from what a probe keeps', async () => {
    const field =
      "input.apiKey !== '' && input.password.length > 3 && [input.note]";
    const { trace } = await evalConditionTraced(field, scope, '/w');
    const kept = Object.fromEntries(probesOf(field, trace.units[0]));
    expect(kept['input.apiKey']).toEqual({ kind: 'redacted' });
    expect(kept["input.apiKey !== ''"]).toMatchObject({ text: 'true' });
    expect(kept['input.password.length']).toEqual({ kind: 'redacted' });
    expect(kept['input.password.length > 3']).toMatchObject({ text: 'true' });
    expect(kept['input.note']).toEqual({ kind: 'redacted' });
    expect(kept['[input.note]']).toBeUndefined();
    expect(JSON.stringify(trace)).not.toMatch(/hunter2|sk-abc/);
  });

  it('fails in the plain evaluation’s own words when a probe would show in them', async () => {
    const field = 'input.n.filter((x) => x)';
    const plain = await settled(() => evalCondition(field, scope, '/w'));
    expect(plain).toMatchObject({
      message:
        '{{ input.n.filter((x) => x) }} → TypeError: input.n.filter is not a function',
      cause: { reason: 'EXPR_NOT_FUNCTION' },
    });
    const error = await evalConditionTraced(field, scope, '/w').catch(
      (e: unknown) => e,
    );
    expect(await settled(() => Promise.reject(error))).toEqual(plain);
    const unit = (error as ExprError).failure?.trace?.units[0];
    expect(unit?.error?.message).toBe(plain.message);
    expect(probesOf(field, unit)).toEqual([
      ['input.n', { kind: 'number', text: '7', bytes: 1 }],
    ]);
  });

  it('refuses a missing value in mixed text exactly as evalTemplates does', async () => {
    const field = 'n={{ input.gone }}';
    expect(await settled(() => evalTemplateTraced(field, scope, '/o'))).toEqual(
      await settled(() => evalTemplates(field, scope, '/o')),
    );
  });

  it('evaluates plainly with a runner that cannot probe', async () => {
    const runner = runnerWith({});
    setCodeRunner(runner);
    const { value, trace } = await evalConditionTraced(
      'input.n > 1',
      scope,
      '/w',
    );
    expect(value).toBe(true);
    expect(trace.units[0]).toEqual({
      range: [0, 11],
      probes: [],
      probed: 'none',
    });
  });

  it('evaluates plainly when the runner cannot run the probed source', async () => {
    const runner = runnerWith({
      evalExprProbed: async () => {
        throw new Error(
          'the node-vm runner process died while running this evaluation',
        );
      },
    });
    setCodeRunner(runner);
    const { value, trace } = await evalConditionTraced(
      'input.n > 1',
      scope,
      '/w',
    );
    expect(value).toBe(true);
    expect(trace.units[0]?.probed).toBe('none');
    expect(runner.plainCalls()).toBe(1);
  });

  it('lets the plain evaluation decide when the probed one timed out', async () => {
    // The probes' own work may be what ran the clock out: the plain
    // evaluation passes the condition, and the unit reads as unprobed.
    const runner = runnerWith({
      evalExprProbed: async () => {
        throw new Error('Script execution timed out after 1000ms');
      },
    });
    setCodeRunner(runner);
    const { value, trace } = await evalConditionTraced(
      'input.n > 1',
      scope,
      '/w',
    );
    expect(value).toBe(true);
    expect(trace.units[0]).toMatchObject({ probes: [], probed: 'none' });
    expect(runner.plainCalls()).toBe(1);
  });

  it('evaluates plainly a probed unit the runner stopped at its deadline', async () => {
    const runner = runnerWith({
      evalExprProbed: async () => {
        throw new RunnerStopped(
          'evaluation timed out after 1000ms; the node-vm runner process was killed',
          { timedOut: true },
        );
      },
    });
    setCodeRunner(runner);
    const { value, trace } = await evalConditionTraced(
      'input.n > 1',
      scope,
      '/w',
    );
    expect(value).toBe(true);
    expect(trace.units[0]).toMatchObject({ probes: [], probed: 'none' });
    expect(runner.plainCalls()).toBe(1);
  });

  it('never evaluates again an expression whose runner broke', async () => {
    const runner = runnerWith({
      evalExprProbed: async () => {
        throw new RunnerStopped(
          'the node-vm runner process died twice before acknowledging this evaluation',
        );
      },
    });
    setCodeRunner(runner);
    const error = await evalConditionTraced('input.n > 1', scope, '/w').catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ExprError);
    expect((error as ExprError).stopped).toBe(true);
    expect(runner.plainCalls()).toBe(0);
    // Nor does explaining it.
    expect(await explainFailure(error, scope)).toBe(false);
  });

  it('answers the plain value when the second evaluation does not throw', async () => {
    const runner = runnerWith({
      evalExprProbed: async () => ({
        value: undefined,
        probes: [[0, { kind: 'number', text: '0.1' }]],
        error: { message: 'Error: unlucky', name: 'Error' },
      }),
    });
    setCodeRunner(runner);
    const { value, trace } = await evalConditionTraced('input.n', scope, '/w');
    expect(value).toBe(7);
    expect(trace.units[0]).toMatchObject({ probes: [], probed: 'none' });
  });
});

const ATOMS = [
  'input',
  'input.total',
  'input.items',
  'input.name',
  'input.owner',
  'input.owner?.name',
  'input.owner.name',
  'input.items[index]',
  'nodes.a.output',
  'nodes.a.output.items',
  'nodes.a.output?.[0]',
  'nodes.b.output.status',
  'nodes.b.output.items',
  'nodes.gone.output',
  'item',
  'index',
  '1',
  '0',
  '"open"',
  'null',
  'true',
  'undefined',
  'nope',
];
const BINARY = [
  '+',
  '-',
  '*',
  '>',
  '>=',
  '<',
  '===',
  '!==',
  '==',
  '&&',
  '||',
  '??',
  'in',
];

function pick<T>(random: Random, items: readonly T[]): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error('pick from an empty list');
  return item;
}

/** A random expression over the scope {@link scopeOf} draws. */
function exprOf(random: Random, depth: number): string {
  if (depth <= 0 || random() < 0.25) return pick(random, ATOMS);
  const sub = () => exprOf(random, depth - 1);
  switch (Math.floor(random() * 14)) {
    case 0:
    case 1:
    case 2:
      return `(${sub()}) ${pick(random, BINARY)} (${sub()})`;
    case 3:
      return `!(${sub()})`;
    case 4:
      return `typeof (${sub()})`;
    case 5:
      return `(${sub()}) ? (${sub()}) : (${sub()})`;
    case 6:
      return `(${sub()}).length`;
    case 7:
      return `(${sub()})?.length`;
    case 8:
      return `(${sub()}).includes(${sub()})`;
    case 9:
      return `(${sub()}).map((x) => x)`;
    case 10:
      return `String(${sub()})`;
    case 11:
      return `[${sub()}, ...(${sub()})]`;
    case 12:
      return `({ k: ${sub()} })[${pick(random, ['"k"', '"z"'])}]`;
    default:
      return `\`<\${${sub()}}>\``;
  }
}

function scopeOf(random: Random): Record<string, unknown> {
  return {
    input: {
      total: Math.floor(random() * 10),
      items: randomJson(random, 2),
      name: pick(random, ['Ada', '', 'x'.repeat(90)]),
      owner: random() < 0.5 ? { name: 'Grace' } : null,
    },
    nodes: {
      a: { output: randomJson(random, 3) },
      b: {
        output: { status: pick(random, ['open', 'done']), items: [1, 2, 3] },
      },
    },
    item: randomJson(random, 2),
    index: Math.floor(random() * 3),
  };
}

describe('traced evaluation — what a probe may never do', () => {
  const login = { user: 'ada', password: 'hunter2', pin: 4821 };
  const scope = { input: { login, n: 2 } };

  /** Every text a trace shows, item texts and names included. */
  function textsOf(units: readonly EvalUnitTrace[]): string {
    return JSON.stringify(units.map((unit) => unit.probes));
  }

  it.each([
    "JSON.stringify(input.login).includes('x')",
    "Object.values(input.login).includes('x')",
    "(({ ['password']: p }) => p)(input.login).length > 0",
    "(({ 'password': p }) => p)(input.login).length > 0",
    "(input.login.user + ':' + input.login['pass' + 'word']).length > 0",
    '`${input.login.user}/${Object.values(input.login)[1]}`.length > 0',
    'String(Object.values(input.login)[2]).length > 0',
  ])(
    'never shows a secret the expression made something of: %s',
    async (expr) => {
      const { trace } = await evalConditionTraced(expr, scope, '/w');
      expect(trace.units[0]?.probed).toBe('full');
      const shown = textsOf(trace.units);
      expect(shown).not.toContain('hunter2');
      expect(shown).not.toContain('4821');
    },
  );

  it('never shows the start of a secret a cut left behind', async () => {
    const long = {
      input: { login: { token: `${'a'.repeat(76)}hunter2-and-more` } },
    };
    const { trace } = await evalConditionTraced(
      'JSON.stringify(input.login).length > 0',
      long,
      '/w',
    );
    expect(textsOf(trace.units)).not.toContain('hunt');
  });

  it('answers what the plain evaluation answers when the expression replaces JSON.stringify', async () => {
    const expr = `(JSON.stringify = function () { return '{"v":true}'; }, false)`;
    await expect(evalCondition(expr, scope)).resolves.toBe(false);
    await expect(
      evalConditionTraced(expr, scope, '/w').then((t) => t.value),
    ).resolves.toBe(false);
  });

  it('never runs an accessor or a toJSON of the value it summarizes', async () => {
    const counted =
      '[(x => x)({ n: 0, get toJSON() { this.n++; return undefined; } })].map(o => o.n)[0]';
    await expect(evalCondition(counted, scope)).resolves.toBe(0);
    await expect(
      evalConditionTraced(counted, scope, '/w').then((t) => t.value),
    ).resolves.toBe(0);
    const prototypeSetter =
      "(Object.defineProperty(Array.prototype, '0', { set(v) { Array.prototype.hits = (Array.prototype.hits || 0) + 1; }, configurable: true }), input.login, [].hits)";
    await expect(
      evalCondition(prototypeSetter, scope),
    ).resolves.toBeUndefined();
    await expect(
      evalConditionTraced(prototypeSetter, scope, '/w').then((t) => t.value),
    ).resolves.toBeUndefined();
  });

  it('keeps the wrapper out of the expression’s reach', async () => {
    await expect(
      evalConditionTraced('arguments.callee.caller === null', scope, '/w').then(
        (t) => t.value,
      ),
    ).resolves.toBe(true);
  });

  it('never fails a condition the plain evaluation passes because summaries cost time', async () => {
    const wide = Object.fromEntries(
      Array.from({ length: 200_000 }, (_, i) => [`key${i}`, i]),
    );
    const big = { nodes: { a: { output: wide } }, input: { n: 50_000_000 } };
    const terms = Array.from(
      { length: 10 },
      (_, i) => `nodes.a.output.key${i} >= 0`,
    );
    await expect(
      evalConditionTraced(terms.join(' && '), big, '/w').then((t) => t.value),
    ).resolves.toBe(true);
    await expect(
      evalConditionTraced('Array(input.n).length > 0', big, '/w').then(
        (t) => t.value,
      ),
    ).resolves.toBe(true);
  }, 30_000);

  it('throws exactly what the plain evaluation throws without a runner', async () => {
    setCodeRunner(null as never);
    const plain = await settled(() =>
      evalCondition('input.n > 1', scope, '/w'),
    );
    const traced = await settled(() =>
      evalConditionTraced('input.n > 1', scope, '/w'),
    );
    setCodeRunner(nodeVmRunner());
    expect(plain).toMatchObject({ cause: { reason: 'EXPR_FAILED' } });
    expect(traced).toEqual(plain);
  });

  it('keeps the operand that decided a long chain, and says it left some out', async () => {
    const names = 'abcdefghijkl'.split('');
    const input = Object.fromEntries(names.map((k) => [k, k === 'l' ? 0 : 1]));
    const field = names.map((k) => `input.${k} > 0`).join(' && ');
    const { value, trace } = await evalConditionTraced(field, { input }, '/w');
    expect(value).toBe(false);
    expect(trace.units[0]?.probed).toBe('partial');
    expect(probesOf(field, trace.units[0]).map(([source]) => source)).toContain(
      'input.l > 0',
    );
  });
});

describe('traced evaluation — parity with the plain evaluation (seeded)', () => {
  it('the probed source evaluates as the plain one, through the real node-vm runner', async () => {
    const runner = codeRunner();
    const random = seeded(4242);
    let compared = 0;
    for (let i = 0; i < 150; i++) {
      const expr = exprOf(random, 3);
      const scope = scopeOf(random);
      const parsed = parseExpressionIn(expr, 0, expr.length);
      if (!parsed.ok) continue;
      const source = instrument(expr, [0, expr.length], probePlan(parsed));
      if (source === null) continue;
      const limits = { timeoutMs: 1000 };
      const plain = await runner.evalExpr(expr, scope, limits).then(
        (value) => ({ value }),
        (e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }),
      );
      const answer = await runner.evalExprProbed?.(source, scope, limits);
      if (answer === undefined) throw new Error('node-vm probes');
      compared += 1;
      if ('value' in plain) {
        expect({ expr, error: answer.error, value: answer.value }).toEqual({
          expr,
          error: undefined,
          value: plain.value,
        });
      } else {
        // The engine's own words are the plain ones, unless they print the
        // source of a probed part (`__taleProbe$(...).map is not a function`).
        const message = answer.error?.message ?? '(no error)';
        expect({
          expr,
          same: message === plain.error || message.includes('__taleProbe$'),
        }).toEqual({ expr, same: true });
      }
    }
    expect(compared).toBeGreaterThan(140);
  });

  it('a traced condition answers or fails exactly as the plain one, in every form', async () => {
    const random = seeded(777);
    for (let i = 0; i < 150; i++) {
      const expr = exprOf(random, 3);
      const scope = scopeOf(random);
      const field = pick(random, [expr, `{{ ${expr} }}`, `x {{ ${expr} }} y`]);
      expect({
        field,
        traced: await settled(
          async () =>
            (await evalConditionTraced(field, scope, '/nodes/0/when')).value,
        ),
      }).toEqual({
        field,
        traced: await settled(() =>
          evalCondition(field, scope, '/nodes/0/when'),
        ),
      });
    }
  });
});

describe('explainFailure', () => {
  const scope = {
    input: { n: 7 },
    nodes: { fetch: { output: { items: null } } },
  };

  async function failureOf(run: () => Promise<unknown>): Promise<ExprError> {
    const error = await run().then(
      () => new Error('expected a failure'),
      (e: unknown) => e,
    );
    if (error instanceof ExprError) return error;
    throw error;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('attaches what the failing expression’s parts held', async () => {
    const error = await failureOf(() =>
      evalTemplates(
        'Count: {{ nodes.fetch.output.items.length }}',
        scope,
        '/nodes/1/prompt',
      ),
    );
    await expect(explainFailure(error, scope)).resolves.toBe(true);
    expect(error.failure?.trace).toEqual({
      pointer: '/nodes/1/prompt',
      units: [
        {
          range: [10, 41],
          probes: [
            {
              range: [10, 28],
              v: { kind: 'object', keys: 1, names: ['items'], bytes: 14 },
            },
          ],
          error: { message: error.message },
          probed: 'full',
        },
      ],
    });
    // The failure itself is unchanged.
    expect(error.failure?.reason).toBe('EXPR_READ_MISSING');
  });

  it.each([
    ['whole', 'hunter22'],
    ['cut to its start', `sk-${'q'.repeat(40)}`],
  ])(
    'keeps a secret of the scope out of the trace’s copy of the message (%s)',
    async (_quoted, secret) => {
      const withSecret = { input: { apiKey: secret } };
      const error = await failureOf(() =>
        evalTemplates('{{ JSON.parse(input.apiKey) }}', withSecret, '/w'),
      );
      expect(error.message).toContain(secret.slice(0, 8));
      await expect(explainFailure(error, withSecret)).resolves.toBe(true);
      const traced = error.failure?.trace?.units[0]?.error?.message ?? '';
      expect(traced).toContain('[withheld]');
      expect(traced).not.toContain(secret.slice(0, 8));
    },
  );

  it('explains a value missing from text', async () => {
    const error = await failureOf(() =>
      evalTemplates('n={{ input.gone }}', scope, '/output/text'),
    );
    await expect(explainFailure(error, scope)).resolves.toBe(true);
    expect(error.failure?.trace?.units[0]?.probes).toEqual([
      { range: [5, 15], v: { kind: 'undefined' } },
    ]);
  });

  it('leaves a timeout, a traced failure and any other error alone', async () => {
    const timeout = new ExprError('input.n', 'timed out', {
      reason: 'EXPR_TIMEOUT',
      params: { limitMs: 1000 },
      at: { pointer: '/w', range: [0, 7] },
    });
    await expect(explainFailure(timeout, scope)).resolves.toBe(false);
    expect(timeout.failure?.trace).toBeUndefined();
    const traced = await evalConditionTraced('input.n.x.y', scope, '/w').catch(
      (e: unknown) => e,
    );
    const before = (traced as ExprError).failure?.trace;
    await expect(explainFailure(traced, scope)).resolves.toBe(false);
    expect((traced as ExprError).failure?.trace).toBe(before);
    await expect(explainFailure(new Error('x'), scope)).resolves.toBe(false);
    const unplaced = await failureOf(() => evalTemplates('{{ nope }}', scope));
    await expect(explainFailure(unplaced, scope)).resolves.toBe(false);
  });

  it('attaches nothing when the second evaluation fails another way', async () => {
    const error = await evalTemplates(
      '{{ nodes.x.output.items.length }}',
      { nodes: { x: { output: {} } } },
      '/nodes/0/prompt',
    ).catch((e: unknown) => e);
    expect((error as ExprError).failure?.reason).toBe('EXPR_READ_MISSING');
    // Explained on a scope where the expression fails as an unknown name.
    expect(await explainFailure(error, { input: {} })).toBe(false);
    expect((error as ExprError).failure?.trace).toBeUndefined();
  });

  it('does nothing without a runner that probes, and never throws', async () => {
    const error = await failureOf(() =>
      evalCondition('input.n.x.y', scope, '/w'),
    );
    setCodeRunner(runnerWith({}));
    await expect(explainFailure(error, scope)).resolves.toBe(false);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    setCodeRunner(
      runnerWith({
        evalExprProbed: async () => {
          throw new Error('Script execution timed out after 1000ms');
        },
      }),
    );
    await expect(explainFailure(error, scope)).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    setCodeRunner(
      runnerWith({
        evalExprProbed: async () => ({ value: 1, probes: [] }),
      }),
    );
    await expect(explainFailure(error, scope)).resolves.toBe(false);
    expect(error.failure?.trace).toBeUndefined();
  });
});

describe('evalTemplatesRendered', () => {
  const scope = {
    input: { name: 'Ada', n: 3, list: [1, 2], none: null },
  };

  it('answers evalTemplates’ value, and where each unit landed in mixed text', async () => {
    const value = {
      prompt: 'Hi {{ input.name }}, {{ input.n }} items: {{ input.list }}.',
      single: '{{ input.n }}',
      list: ['x{{ input.n }}', 'plain'],
    };
    const rendered = await evalTemplatesRendered(
      value,
      scope,
      '/nodes/0/input',
    );
    expect(rendered.value).toEqual(
      await evalTemplates(value, scope, '/nodes/0/input'),
    );
    expect(rendered.rendered).toEqual({
      '/nodes/0/input/prompt': [
        { unit: [6, 16], out: [3, 6] },
        { unit: [24, 31], out: [8, 9] },
        { unit: [45, 55], out: [17, 22] },
      ],
      '/nodes/0/input/list/0': [{ unit: [4, 11], out: [1, 2] }],
    });
    const prompt = (rendered.value as { prompt: string }).prompt;
    expect(
      rendered.rendered['/nodes/0/input/prompt']?.map(({ unit, out }) => [
        value.prompt.slice(...unit),
        prompt.slice(...out),
      ]),
    ).toEqual([
      ['input.name', 'Ada'],
      ['input.n', '3'],
      ['input.list', '[1,2]'],
    ]);
  });

  it('fails exactly as evalTemplates does', async () => {
    for (const value of [
      { a: 'n={{ input.none }}' },
      { a: ['{{ input.name.x.y }}'] },
    ]) {
      expect(
        await settled(() => evalTemplatesRendered(value, scope, '/p')),
      ).toEqual(await settled(() => evalTemplates(value, scope, '/p')));
    }
  });

  it('keeps the spans of a field’s first units, up to the cap', async () => {
    const text = Array.from({ length: 40 }, () => '{{ input.n }}').join(',');
    const rendered = await evalTemplatesRendered(text, scope, '/t');
    expect(rendered.value).toBe(
      Array.from({ length: 40 }, () => '3').join(','),
    );
    expect(rendered.rendered['/t']).toHaveLength(RENDERED_SPANS_PER_FIELD);
  });
});
