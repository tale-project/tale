// @vitest-environment node

import vm from 'node:vm';

import { randomJson, seeded, type Random } from '@tale/ui/data/random-json';
import { summaryOf } from '@tale/ui/data/value-summary';
import { parse as acornParse } from 'acorn';
import { describe, expect, it } from 'vitest';

import { parseExpressionIn } from './parse';
import {
  CALL_FN,
  instrument,
  planProbes,
  PREVIEW_FN,
  PROBE_FN,
  probedExprSource,
  probePlan,
  PROBES_PER_UNIT,
  type ProbeSpec,
  readProbedAnswer,
} from './probe';

function planOf(text: string, from = 0, to = text.length): ProbeSpec[] {
  const parsed = parseExpressionIn(text, from, to);
  if (!parsed.ok) throw new Error(`does not parse: ${parsed.message}`);
  return probePlan(parsed);
}

/** The source text of every probed sub-expression, in plan order. */
function probed(text: string): string[] {
  return planOf(text).map((spec) => text.slice(...spec.range));
}

function instrumented(text: string): string {
  const out = instrument(text, [0, text.length], planOf(text));
  if (out === null) throw new Error('not instrumentable');
  return out;
}

/** A context as the node-vm child builds one: a null-prototype global, no
 * code generation, and the scope parsed inside it. */
function contextWith(scope: Record<string, unknown>): vm.Context {
  const sandbox: Record<string, unknown> = Object.create(null);
  const context = vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
  });
  sandbox.__scopeJson = JSON.stringify(scope);
  vm.runInContext('__scope = JSON.parse(__scopeJson)', context);
  delete sandbox.__scopeJson;
  return context;
}

function keysOf(scope: Record<string, unknown>): string[] {
  return Object.keys(scope).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k));
}

/** The probed wrapper, run in-process the way a runner runs it. */
function runProbed(source: string, scope: Record<string, unknown> = {}) {
  const out: unknown = new vm.Script(
    probedExprSource(source, keysOf(scope)),
  ).runInContext(contextWith(scope), { timeout: 1000 });
  const answer = readProbedAnswer(typeof out === 'string' ? out : null);
  const parsed: unknown =
    answer.valueJson === null ? undefined : JSON.parse(answer.valueJson);
  return {
    ...answer,
    value:
      parsed !== null && typeof parsed === 'object' && 'v' in parsed
        ? parsed.v
        : undefined,
  };
}

/** The plain wrapper, as node-vm's evalExpr builds it. */
function runPlain(
  expr: string,
  scope: Record<string, unknown> = {},
): { value: unknown } | { error: string } {
  const keys = keysOf(scope);
  const source = `JSON.stringify({ v: (function(${keys.join(', ')}) { return (${expr}); })(${keys.map((k) => `__scope.${k}`).join(', ')}) })`;
  try {
    const out: unknown = new vm.Script(source).runInContext(
      contextWith(scope),
      { timeout: 1000 },
    );
    const parsed: unknown = typeof out === 'string' ? JSON.parse(out) : null;
    return {
      value:
        parsed !== null && typeof parsed === 'object' && 'v' in parsed
          ? parsed.v
          : undefined,
    };
  } catch (error) {
    return { error: String(error) };
  }
}

describe('probePlan — where a probe may go', () => {
  it('probes an operator and its scope reads, never a literal', () => {
    expect(probed('input.n > 5')).toEqual(['input.n > 5', 'input.n']);
    expect(probed('index + 1')).toEqual(['index + 1', 'index']);
    expect(probed('-1 < input.n')).toEqual(['-1 < input.n', 'input.n']);
  });

  it('probes both operands of a short-circuit; the skipped one never fires', () => {
    expect(probed('input.a && input.b')).toEqual([
      'input.a && input.b',
      'input.a',
      'input.b',
    ]);
    const answer = runProbed(instrumented('input.a && input.b'), {
      input: { a: false, b: true },
    });
    expect(answer.value).toBe(false);
    expect(answer.probes.map(([k]) => k).toSorted((a, b) => a - b)).toEqual([
      0, 1,
    ]);
  });

  it('keeps an optional chain whole, and the part before its first `?.`', () => {
    expect(probed('input.a?.b.c')).toEqual(['input.a?.b.c', 'input.a']);
    expect(probed('nodes.fetch.output?.items?.length')).toEqual([
      'nodes.fetch.output?.items?.length',
      'nodes.fetch.output',
    ]);
    expect(probed("input.tags?.includes('x')")).toEqual([
      "input.tags?.includes('x')",
      'input.tags',
    ]);
    // Evaluated: the chain still short-circuits instead of throwing.
    expect(
      runProbed(instrumented('input.a?.b.c'), { input: {} }).value,
    ).toBeUndefined();
  });

  it('never probes a callee, only what it is called on', () => {
    expect(probed('input.list.map((x) => x * 2)')).toEqual([
      'input.list.map((x) => x * 2)',
      'input.list',
    ]);
    expect(probed('input.trim()')).toEqual(['input.trim()', 'input']);
    expect(probed('Math.max(input.a, 1)')).toEqual([
      'Math.max(input.a, 1)',
      'input.a',
    ]);
    // The receiver survives: `this` inside the method is still the list.
    expect(
      runProbed(instrumented("input.list.join('-')"), {
        input: { list: [1, 2] },
      }).value,
    ).toBe('1-2');
  });

  it('never probes inside a nested function body', () => {
    expect(
      probed('input.list.filter(function (x) { return x > input.n; })'),
    ).toEqual([
      'input.list.filter(function (x) { return x > input.n; })',
      'input.list',
    ]);
    expect(probed('input.list.some((x) => x.ok && input.n)')).toEqual([
      'input.list.some((x) => x.ok && input.n)',
      'input.list',
    ]);
  });

  it('never probes the operand of `typeof <name>`, but does a member', () => {
    expect(probed("typeof item === 'undefined'")).toEqual([
      "typeof item === 'undefined'",
    ]);
    expect(probed('typeof input.x')).toEqual(['typeof input.x', 'input.x']);
    expect(
      runProbed(instrumented("typeof item === 'undefined'"), {}).value,
    ).toBe(true);
  });

  it('never probes a target, a key, a shorthand value or a `new` callee', () => {
    expect(probed('delete input.a')).toEqual([]);
    expect(probed('input.n++')).toEqual([]);
    expect(probed('(x = input.a)')).toEqual(['input.a']);
    expect(probed('({ [input.k]: input.v, input })')).toEqual(['input.v']);
    expect(probed('new input.C(input.a)')).toEqual([
      'new input.C(input.a)',
      'input.a',
    ]);
  });

  it('reads a chain whole, plus the step output it reads into', () => {
    expect(probed('nodes.fetch.output.items.length > 0')).toEqual([
      'nodes.fetch.output.items.length > 0',
      'nodes.fetch.output.items.length',
      'nodes.fetch.output',
    ]);
    expect(probed('nodes.fetch.output')).toEqual(['nodes.fetch.output']);
    expect(probed('input.list[index]')).toEqual(['input.list[index]', 'index']);
    expect(probed('Math.PI * 2')).toEqual(['Math.PI * 2']);
  });

  it('probes spread, template and conditional parts as values', () => {
    expect(probed('Math.max(...input.list)')).toEqual([
      'Math.max(...input.list)',
      'input.list',
    ]);
    expect(probed('`n=${input.n}`')).toEqual(['input.n']);
    expect(probed('input.ok ? input.a : input.b')).toEqual([
      'input.ok ? input.a : input.b',
      'input.ok',
      'input.a',
      'input.b',
    ]);
    expect(probed('String.raw`${input.a}`')).toEqual(['input.a']);
  });

  it('plans nothing for a source that names the probe', () => {
    expect(planOf(`${PROBE_FN}(0, input)`)).toEqual([]);
    expect(planOf(`input.n + ${PREVIEW_FN}`)).toEqual([]);
  });

  it('keeps the first 32 sub-expressions, outermost first', () => {
    const text = Array.from({ length: 40 }, (_, i) => `input.v${i}`).join(
      ' + ',
    );
    const specs = planOf(text);
    expect(specs).toHaveLength(PROBES_PER_UNIT);
    expect(specs[0]?.range).toEqual([0, text.length]);
  });

  it('places ranges in the field, not the unit', () => {
    const field = 'Total: {{ input.n * 2 }}';
    const specs = planOf(field, 10, 21);
    expect(specs.map((s) => field.slice(...s.range))).toEqual([
      'input.n * 2',
      'input.n',
    ]);
  });

  it('marks what reads a member named like a secret', () => {
    const marks = (text: string) =>
      planOf(text).map((s) => [text.slice(...s.range), s.secret]);
    expect(marks('input.apiKey.trim()')).toEqual([
      ['input.apiKey.trim()', 'derived'],
      ['input.apiKey', 'read'],
    ]);
    expect(marks("input['password'].length > 3")).toEqual([
      ["input['password'].length > 3", 'derived'],
      ["input['password'].length", 'derived'],
    ]);
    expect(marks('nodes.list.output.nextPageToken')).toEqual([
      ['nodes.list.output.nextPageToken', 'read'],
      ['nodes.list.output', undefined],
    ]);
    // A step named `token` is a step, not a secret.
    expect(marks('nodes.token.output.n')).toEqual([
      ['nodes.token.output.n', undefined],
      ['nodes.token.output', undefined],
    ]);
    expect(marks('input.users.map(({ password }) => password)')).toEqual([
      ['input.users.map(({ password }) => password)', 'derived'],
      ['input.users', undefined],
    ]);
  });
});

describe('planProbes — what a capped plan keeps', () => {
  function plan(text: string) {
    const parsed = parseExpressionIn(text, 0, text.length);
    if (!parsed.ok) throw new Error(`does not parse: ${parsed.message}`);
    return planProbes(parsed);
  }

  it('keeps every operand of a long chain ahead of the parts in between', () => {
    const terms = 'abcdefghijkl'.split('').map((k) => `input.${k} > 0`);
    const text = terms.join(' && ');
    const { specs, capped } = plan(text);
    expect(capped).toBe(true);
    expect(specs.length).toBeLessThanOrEqual(PROBES_PER_UNIT);
    const kept = specs.map((spec) => text.slice(...spec.range));
    for (const term of terms) expect(kept).toContain(term);
    expect(kept).toContain(text);
  });

  it('keeps a conditional’s parts', () => {
    const tail = Array.from({ length: 20 }, (_, i) => `input.x${i}`).join(
      ' + ',
    );
    const text = `input.go ? (${tail}) : input.other`;
    const kept = plan(text).specs.map((spec) => text.slice(...spec.range));
    expect(kept).toContain('input.go');
    expect(kept).toContain('input.other');
  });

  it('is not capped when every candidate fits', () => {
    expect(plan('input.a > 1 && input.b').capped).toBe(false);
  });

  it('plans nothing for a source that names the call the wrapper makes', () => {
    expect(plan(`typeof ${CALL_FN} === 'function'`)).toEqual({
      specs: [],
      capped: false,
    });
  });
});

describe('instrument', () => {
  it('splices the probe around each spec, nested in order', () => {
    expect(instrumented('input.n > 5')).toBe(
      '__taleProbe$(0,(__taleProbe$(1,(input.n)) > 5))',
    );
    const field = 'x {{ input.a ?? 1 }}';
    expect(instrument(field, [5, 17], planOf(field, 5, 17))).toBe(
      '__taleProbe$(0,(__taleProbe$(1,(input.a)) ?? 1))',
    );
  });

  it('keeps a probe from merging into the word before it', () => {
    expect(instrumented('typeof-input.n')).toBe(
      '__taleProbe$(0,(typeof __taleProbe$(1,(-__taleProbe$(2,(input.n))))))',
    );
    expect(runProbed(instrumented('void!input.n'), { input: {} }).value).toBe(
      undefined,
    );
  });

  it('refuses a unit that names the probe, and specs that do not nest', () => {
    expect(instrument(PROBE_FN, [0, 12], [])).toBeNull();
    expect(instrument('a /* __talePreview$ */', [0, 22], [])).toBeNull();
    const text = 'input.a + input.b';
    expect(
      instrument(
        text,
        [0, text.length],
        [{ range: [0, 9] }, { range: [8, 17] }],
      ),
    ).toBeNull();
    expect(instrument(text, [0, text.length], [{ range: [0, 30] }])).toBeNull();
    expect(instrument(text, [0, text.length], [{ range: [3, 3] }])).toBeNull();
    expect(
      instrument(
        text,
        [0, text.length],
        Array.from({ length: 33 }, () => ({
          range: [0, 7] as [number, number],
        })),
      ),
    ).toBeNull();
  });

  it('answers the unit unchanged with no specs', () => {
    expect(instrument('{{ input }}', [3, 8], [])).toBe('input');
  });

  it('round-trips: the instrumented source parses and evaluates as the original', () => {
    const scope = {
      input: {
        n: 3,
        list: [1, 2, { id: 3 }],
        name: 'Ada',
        owner: null,
        tags: ['a'],
      },
      nodes: { fetch: { output: { items: [{ ok: true }], total: 2 } } },
      item: { id: 1 },
      index: 2,
    };
    const corpus = [
      'input.n > 2 && input.list.length === 3',
      'input.owner?.name ?? input.name',
      "input.tags.includes('a') || !input.n",
      'nodes.fetch.output.items.filter((x) => x.ok).length',
      'input.list[index]?.id',
      '`${input.name}:${input.n * 2}`',
      'typeof item === "object" ? item.id : -1',
      '[...input.list, ...input.tags].length',
      'Object.keys(nodes.fetch.output).join(",")',
      'input.list.map((x) => typeof x)',
      '({ total: nodes.fetch.output.total, n: input.n })',
      '(input.n, input.name)',
      'input.name.toUpperCase().split("")',
      'new Date(0).getTime() + input.n',
      'input.missing?.deep?.(1)',
      'String.raw`${input.n}`',
      'input?.list?.[index]?.id',
      'arguments.length',
    ];
    for (const text of corpus) {
      const source = instrumented(text);
      expect(() =>
        acornParse(`(${source})`, { ecmaVersion: 2024 }),
      ).not.toThrow();
      const answer = runProbed(source, scope);
      expect({ text, value: answer.value, error: answer.error }).toEqual({
        text,
        value: (runPlain(text, scope) as { value: unknown }).value,
        error: undefined,
      });
    }
  });
});

describe('probedExprSource — the wrapper both runners evaluate', () => {
  it('answers the value and every probe it took', () => {
    const answer = runProbed(instrumented('input.n > 5'), { input: { n: 7 } });
    expect(answer.value).toBe(true);
    expect(answer.error).toBeUndefined();
    expect(answer.probes).toEqual([
      [1, { kind: 'number', text: '7', bytes: 1 }],
      [0, { kind: 'boolean', text: 'true', bytes: 4 }],
    ]);
  });

  it('answers an error the expression throws, with the probes taken before it', () => {
    const answer = runProbed(instrumented('input.a.b'), { input: {} });
    expect(answer.error).toEqual({
      message: "TypeError: Cannot read properties of undefined (reading 'b')",
      name: 'TypeError',
    });
    expect(answer.valueJson).toBeNull();
    expect(answer.probes).toEqual([]);
    const partial = runProbed(instrumented('input.a > 1 && input.a.b.c'), {
      input: { a: 2 },
    });
    expect(partial.error?.message).toMatch(/reading 'c'/);
    expect(partial.probes.map(([k]) => k)).toEqual([2, 1]);
    expect(runProbed('(() => { throw "boom"; })()').error).toEqual({
      message: 'boom',
    });
  });

  it('serializes the value exactly as the plain wrapper does', () => {
    for (const text of [
      'undefined',
      '({ f: () => 1, v: 2 })',
      '[undefined, 1]',
      'new Date(0)',
      '0 / 0',
    ]) {
      expect(runProbed(text).value).toEqual(
        (runPlain(text) as { value: unknown }).value,
      );
    }
    expect(runProbed('10n').error?.message).toBe(
      (runPlain('10n') as { error: string }).error,
    );
  });

  it('shows the expression nothing of its own beyond the probe', () => {
    for (const name of [
      'probes',
      'count',
      'json',
      'isArray',
      'summary',
      'STOP',
      '__taleRun$',
      PREVIEW_FN,
    ]) {
      expect(runProbed(`typeof ${name}`, { input: 1 }).value).toBe('undefined');
    }
    expect(runProbed('arguments.length', { input: 1, nodes: {} }).value).toBe(
      2,
    );
    expect(runProbed('typeof __scope', {}).value).toBe('object');
  });

  it('keeps at most 32 probes', () => {
    const source = `[${Array.from({ length: 40 }, (_, i) => `${PROBE_FN}(${i % 32},(${i}))`).join(', ')}]`;
    const answer = runProbed(source);
    expect(answer.probes).toHaveLength(32);
    expect((answer.value as number[]).length).toBe(40);
  });

  it('summarizes with the intrinsics it found, whatever the expression reassigns', () => {
    const answer = runProbed(
      `(Array.isArray = () => false, Object.keys = () => [], String.prototype.slice = () => "x", String.prototype.charCodeAt = () => 0, JSON.stringify = JSON.stringify, ${PROBE_FN}(0,(input)))`,
      { input: { list: [1, 'é'], name: 'y'.repeat(90) } },
    );
    expect(answer.probes).toEqual([
      [0, summaryOf({ list: [1, 'é'], name: 'y'.repeat(90) })],
    ]);
  });

  it('never runs authored code to summarize: a getter, a toJSON or a cycle leaves the size out', () => {
    const getter = runProbed(
      `(() => { let n = 0; const o = { get x() { n += 1; return n; } }; ${PROBE_FN}(0,(o)); return n; })()`,
    );
    expect(getter.value).toBe(0);
    expect(getter.probes).toEqual([
      [0, { kind: 'object', keys: 1, names: ['x'] }],
    ]);
    const custom = runProbed(`${PROBE_FN}(0,({ toJSON() { return 1; } }))`);
    expect(custom.probes[0]?.[1]).toEqual({
      kind: 'object',
      keys: 1,
      names: ['toJSON'],
    });
    const cycle = runProbed(
      `(() => { const a = { n: 1 }; a.self = a; return ${PROBE_FN}(0,(a)).n; })()`,
    );
    expect(cycle.value).toBe(1);
    expect(cycle.probes[0]?.[1]).toEqual({
      kind: 'object',
      keys: 2,
      names: ['n', 'self'],
    });
  });

  it('a summary never fails the expression', () => {
    const answer = runProbed(
      `(() => { const p = Proxy.revocable({}, {}); p.revoke(); ${PROBE_FN}(0,(p.proxy)); return 1; })()`,
    );
    expect(answer.value).toBe(1);
    // It could not be read: left out, never guessed.
    expect(answer.probes).toEqual([[0, { kind: 'elided' }]]);
  });
});

/** Values a summary has edges for: cut text around a surrogate pair, many
 * and long names, wide and nested lists, unusual numbers. */
function edgeValue(random: Random): unknown {
  const roll = random();
  const emojiAt = (length: number, at: number) =>
    `${'a'.repeat(at)}😀${'b'.repeat(Math.max(0, length - at - 2))}`;
  if (roll < 0.15)
    return emojiAt(
      70 + Math.floor(random() * 30),
      78 + Math.floor(random() * 3),
    );
  if (roll < 0.3) {
    const value: Record<string, unknown> = {};
    const count = Math.floor(random() * 14);
    for (let i = 0; i < count; i++) {
      value[i % 3 === 0 ? emojiAt(90, 79) : `k${i}`] = randomJson(random, 1);
    }
    return value;
  }
  if (roll < 0.45) {
    return Array.from({ length: Math.floor(random() * 8) }, () =>
      randomJson(random, 2),
    );
  }
  if (roll < 0.55) {
    return [1e21, -0, 1.5e-7, -3, 0.1 + 0.2, Number.MAX_SAFE_INTEGER][
      Math.floor(random() * 6)
    ];
  }
  if (roll < 0.65)
    return ['Zürich', '中文', '\ud800', '"\\\n', ''][Math.floor(random() * 5)];
  return randomJson(random, 4);
}

describe('summary parity — the wrapper answers what summaryOf answers', () => {
  it('for generated JSON values (seeded)', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const random = seeded(seed);
      const values = Array.from({ length: 32 }, () =>
        random() < 0.5 ? randomJson(random, 4) : edgeValue(random),
      );
      const source = `[${values.map((_, i) => `${PROBE_FN}(${i},(input[${i}]))`).join(', ')}]`;
      const answer = runProbed(source, { input: values });
      const byIndex = new Map(answer.probes);
      values.forEach((value, i) => {
        // Through JSON, as the scope crosses: what the expression sees.
        const seen: unknown = JSON.parse(JSON.stringify(value));
        expect({ seed, i, summary: byIndex.get(i) }).toStrictEqual({
          seed,
          i,
          summary: summaryOf(seen),
        });
      });
    }
  });

  it('for values only an expression can make', () => {
    // The same value made here and inside the wrapper's context.
    const made: Array<[string, unknown]> = [
      ['0 / 0', Number.NaN],
      ['1 / 0', Number.POSITIVE_INFINITY],
      ['undefined', undefined],
      ['10n', 10n],
      ['new Date(0)', new Date(0)],
      ['new Date(NaN)', new Date(Number.NaN)],
      ['() => 1', () => 1],
      ["Symbol('s')", Symbol('s')],
      ['[undefined, () => 1, 1]', [undefined, () => 1, 1]],
      [
        '({ a: undefined, b: 1, c: () => 2 })',
        { a: undefined, b: 1, c: () => 2 },
      ],
      ['new Map([[1, 2]])', new Map([[1, 2]])],
      ['[10n, 1]', [10n, 1]],
    ];
    const source = `[${made.map(([text], i) => `${PROBE_FN}(${i},(${text}))`).join(', ')}]`;
    const answer = runProbed(source);
    const byIndex = new Map(answer.probes);
    made.forEach(([text, value], i) => {
      expect({ text, summary: byIndex.get(i) }).toStrictEqual({
        text,
        summary: summaryOf(value),
      });
    });
  });
});

describe('readProbedAnswer', () => {
  it('refuses an answer that is not the wrapper’s', () => {
    expect(() => readProbedAnswer(null)).toThrow(/no readable result/);
    expect(() => readProbedAnswer('nope')).toThrow(/no readable result/);
    expect(() => readProbedAnswer('{"r":"{}"}')).toThrow(/no readable result/);
  });

  it('keeps well-formed probes only, held to a summary’s bounds', () => {
    const answer = readProbedAnswer(
      JSON.stringify({
        p: [
          [
            0,
            { kind: 'string', text: 'x'.repeat(200), length: 200, cut: true },
          ],
          [1.5, { kind: 'number' }],
          [40, { kind: 'number' }],
          [2, { kind: 'secret' }],
          [
            3,
            {
              kind: 'array',
              items: [{ kind: 'null' }, 1, { kind: 'nope' }],
              length: 3,
            },
          ],
          'junk',
        ],
        r: '{"v":1}',
      }),
    );
    expect(answer.probes).toEqual([
      [0, { kind: 'string', text: 'x'.repeat(80), length: 200, cut: true }],
      [3, { kind: 'array', items: [{ kind: 'null' }], length: 3 }],
    ]);
    expect(answer.valueJson).toBe('{"v":1}');
    expect(readProbedAnswer('{"p":[],"e":"boom","n":"Error"}')).toEqual({
      valueJson: null,
      probes: [],
      error: { message: 'boom', name: 'Error' },
    });
  });
});
