// @vitest-environment node

import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

import { MAX_SOURCE_SIZE } from './parse';
import {
  conditionKind,
  exprSegments,
  isSingleTemplate,
  tokenizeTemplate,
} from './tokens';

/** The pre-parser rule, kept here as the oracle: the first `}}` at least one
 * character after the `{{`. */
const LEGACY_RE = /\{\{([\s\S]+?)\}\}/g;

function legacy(
  value: string,
): Array<{ start: number; end: number; source: string }> {
  return [...value.matchAll(LEGACY_RE)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
    source: m[1].trim(),
  }));
}

function exprs(
  value: string,
): Array<{ start: number; end: number; source: string }> {
  return exprSegments(tokenizeTemplate(value)).map((s) => ({
    start: s.start,
    end: s.end,
    source: s.source ?? '',
  }));
}

/** Whether V8 compiles the expression the way the runner wraps it. */
function compiles(expr: string): boolean {
  try {
    void new vm.Script(`(${expr})`);
    return true;
  } catch (e) {
    if (e instanceof Error) return false;
    throw e;
  }
}

describe('tokenizeTemplate — the compatibility matrix', () => {
  it.each([
    ['{{ a }}', ['a']],
    ['x {{ a }} y {{ b }}', ['a', 'b']],
    ['{{ a }}}', ['a']],
    ['{{ {a: 1}}}', ['{a: 1}']],
    ['{{ {a: 1} }}', ['{a: 1}']],
    ["{{ 'a}}b' }}", ["'a}}b'"]],
    ['{{ xs.map(x => ({y: x})) }}', ['xs.map(x => ({y: x}))']],
    ['{{ `a}}${b}` }}', ['`a}}${b}`']],
    ['{{#each items}}', ['#each items']],
  ])('%s', (value, sources) => {
    expect(exprs(value).map((e) => e.source)).toEqual(sources);
  });

  it('keeps the legacy span (unparsed) when no valid expression fits', () => {
    const [seg] = exprSegments(tokenizeTemplate('{{#each items}}'));
    expect(seg).toMatchObject({ start: 0, end: 15, parsed: false });
    const [broken] = exprSegments(tokenizeTemplate('{{ a + }} tail }}'));
    expect(broken).toMatchObject({ source: 'a +', end: 9, parsed: false });
  });

  it.each(['('.repeat(65), 'word '.repeat(513)])(
    'does not budget plain text after a quoted template',
    (suffix) => {
      const value = "{{ 'a}}b' }} " + suffix;
      const result = tokenizeTemplate(value);
      expect(exprSegments(result)).toEqual([
        expect.objectContaining({ source: "'a}}b'", parsed: true, end: 12 }),
      ]);
      expect(
        result.segments
          .map((segment) => value.slice(segment.start, segment.end))
          .join(''),
      ).toBe(value);
      expect(result.unterminated).toEqual([]);
    },
  );

  it('caps missing-closer diagnostics while keeping all text', () => {
    const value = '{{ '.repeat(40);
    const result = tokenizeTemplate(value);
    expect(result.unterminated).toHaveLength(32);
    expect(result.segments).toEqual([
      { kind: 'text', start: 0, end: value.length },
    ]);
  });

  it('an empty pair is text and no unterminated template', () => {
    expect(tokenizeTemplate('{{}}')).toEqual({
      segments: [{ kind: 'text', start: 0, end: 4 }],
      unterminated: [],
    });
  });

  it('a "{{" with no closer is text, listed as unterminated', () => {
    expect(tokenizeTemplate('{{ a }')).toEqual({
      segments: [{ kind: 'text', start: 0, end: 6 }],
      unterminated: [[0, 2]],
    });
    expect(tokenizeTemplate('x {{ a }} y {{ b').unterminated).toEqual([
      [12, 14],
    ]);
  });

  it('segments cover the string, with exact offsets', () => {
    const value = 'Hi {{ input.name }}, see {{ nodes.a.output }}!';
    const { segments } = tokenizeTemplate(value);
    expect(segments.map((s) => value.slice(s.start, s.end)).join('')).toBe(
      value,
    );
    const [first] = exprSegments(tokenizeTemplate(value));
    expect(value.slice(first.exprStart, first.exprEnd)).toBe('input.name');
  });

  it('a trailing line comment would swallow the runner wrapper — not a closer', () => {
    // `return (a // c);` does not compile, so the span stays unparsed.
    const [seg] = exprSegments(tokenizeTemplate('{{ a // c }}'));
    expect(seg.parsed).toBe(false);
    const [ok] = exprSegments(tokenizeTemplate('{{ a /* c */ }}'));
    expect(ok.parsed).toBe(true);
  });
});

describe('tokenizeTemplate — bounded whitespace recovery', () => {
  function measured(value: string) {
    let whitespaceChecks = 0;
    let longTrimmedCharacters = 0;
    const test = RegExp.prototype.test;
    const trimEnd = String.prototype.trimEnd;
    const testSpy = vi
      .spyOn(RegExp.prototype, 'test')
      .mockImplementation(function (this: RegExp, text: string) {
        if (this.source === '\\s') whitespaceChecks++;
        return test.call(this, text);
      });
    const trimSpy = vi
      .spyOn(String.prototype, 'trimEnd')
      .mockImplementation(function (this: string) {
        if (this.length > MAX_SOURCE_SIZE + 2)
          longTrimmedCharacters += this.length;
        return trimEnd.call(this);
      });
    try {
      return {
        result: tokenizeTemplate(value),
        counts: () => ({ whitespaceChecks, longTrimmedCharacters }),
      };
    } finally {
      testSpy.mockRestore();
      trimSpy.mockRestore();
    }
  }

  it.each([
    ['line comment', '{{//}}', ''],
    ['closed comment', '{{1/*}}', '*/'],
    ['malformed prefix and closed comment', '{{1+/*}}', '*/'],
  ])(
    'scans a shared padding suffix once after %s failures',
    (_name, prefix, tail) => {
      for (const count of [16, 64]) {
        for (const closer of ['', '}}']) {
          const value =
            prefix.repeat(count) + tail + ' '.repeat(16384) + closer;
          const { result, counts } = measured(value);
          if (prefix === '{{1/*}}' && closer) {
            // Closing the block comment makes the entire recovered span valid.
            expect(exprSegments(result)).toEqual([
              {
                kind: 'expr',
                start: 0,
                end: value.length,
                exprStart: 2,
                exprEnd: prefix.length * count + tail.length,
                source: (prefix.repeat(count) + tail).slice(2),
                parsed: true,
              },
            ]);
          } else {
            expect(
              exprSegments(result).map(({ start, end, source }) => ({
                start,
                end,
                source,
              })),
            ).toEqual(legacy(value));
            expect(
              exprSegments(result).every((segment) => !segment.parsed),
            ).toBe(true);
          }
          expect(
            result.segments
              .map((segment) => value.slice(segment.start, segment.end))
              .join(''),
          ).toBe(value);
          expect(counts().whitespaceChecks).toBeLessThan(value.length * 2);
          expect(counts().longTrimmedCharacters).toBeLessThan(value.length * 2);
        }
      }
    },
  );

  it('keeps separate whitespace islands and fresh templates independent', () => {
    const padding = ' \t'.repeat(8192);
    const value =
      '{{//}}'.repeat(32) +
      padding +
      '\nseparator ' +
      '{{1+/*}}'.repeat(32) +
      '*/' +
      padding +
      '}}';
    for (const input of [
      value,
      '{{//}}'.repeat(16) + '\t'.repeat(20000) + '}}',
      value,
    ]) {
      const { result, counts } = measured(input);
      expect(
        exprSegments(result).map(({ start, end, source }) => ({
          start,
          end,
          source,
        })),
      ).toEqual(legacy(input));
      expect(exprSegments(result).every((segment) => !segment.parsed)).toBe(
        true,
      );
      expect(
        result.segments
          .map((segment) => input.slice(segment.start, segment.end))
          .join(''),
      ).toBe(input);
      expect(counts().whitespaceChecks).toBeLessThan(input.length * 2);
      expect(counts().longTrimmedCharacters).toBeLessThan(input.length * 2);
    }
  });

  it('preserves a valid quoted closer with long padding after failed spans', () => {
    const prefix = '{{//}}'.repeat(32) + '\n';
    const expression = "'a}}b' /* trailing comment */";
    const value =
      prefix +
      '{{' +
      ' '.repeat(20000) +
      expression +
      '\t'.repeat(20000) +
      '}}';
    const { result, counts } = measured(value);
    const expressions = exprSegments(result);
    expect(
      expressions
        .slice(0, -1)
        .map(({ start, end, source }) => ({ start, end, source })),
    ).toEqual(legacy(prefix));
    expect(expressions.at(-1)).toEqual({
      kind: 'expr',
      start: prefix.length,
      end: value.length,
      exprStart: prefix.length + 20002,
      exprEnd: prefix.length + 20002 + expression.length,
      source: expression,
      parsed: true,
    });
    expect(counts().whitespaceChecks).toBeLessThan(value.length * 2);
    expect(counts().longTrimmedCharacters).toBeLessThan(value.length * 4);
  });
});

describe('isSingleTemplate / conditionKind', () => {
  it('one expression with only whitespace around keeps its type', () => {
    const v = '  {{ input.n }}\n';
    expect(isSingleTemplate(v, tokenizeTemplate(v))).toBe(true);
    const mixed = 'n={{ input.n }}';
    expect(isSingleTemplate(mixed, tokenizeTemplate(mixed))).toBe(false);
    const stray = '{{ a }} {{';
    expect(isSingleTemplate(stray, tokenizeTemplate(stray))).toBe(false);
  });

  it('reads a condition as bare, single or mixed', () => {
    expect(conditionKind('input.ok')).toBe('bare');
    expect(conditionKind(' {{ input.ok }} ')).toBe('single');
    expect(conditionKind('ok: {{ input.ok }}')).toBe('mixed');
    expect(conditionKind('{{ input.ok')).toBe('mixed');
  });
});

describe('tokenizeTemplate — compatible with the first-"}}" rule', () => {
  /** mulberry32: a small deterministic generator, so a failure replays. */
  function rng(seed: number): () => number {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /** Text around templates, stray braces included. */
  const TEXT = ['', ' ', 'Hello ', '\n', '}', '{', ' } ', 'a: ', '#each '];
  /** Expression material: valid expressions and loose fragments that make
   * invalid ones when combined. */
  const EXPR = [
    'a',
    ' input.x ',
    'nodes.a.output.items',
    'nodes.a.output?.x ?? null',
    '{a: 1}',
    ' {a: 1} ',
    'xs.map(x => ({y: x}))',
    "'}}'",
    '`a}}b`',
    'a /* c */',
    '[1, 2][0]',
    '(a)',
    ' + ',
    '(',
    ')',
    "'",
    '//',
    '}',
    '{',
  ];

  it('yields the identical spans whenever every legacy span compiled', () => {
    const next = rng(20261008);
    const pick = (xs: string[]): string => xs[Math.floor(next() * xs.length)];
    let constrained = 0;
    for (let n = 0; n < 6000; n++) {
      let value = '';
      const parts = 1 + Math.floor(next() * 4);
      for (let i = 0; i < parts; i++) {
        value += pick(TEXT);
        if (next() < 0.8) {
          let expr = pick(EXPR);
          if (next() < 0.3) expr += pick(EXPR);
          value += `{{${expr}}}`;
        } else {
          value += next() < 0.5 ? '{{' : '}}';
        }
      }
      value += pick(TEXT);
      const old = legacy(value);
      if (old.length === 0 || !old.every((m) => compiles(m.source))) continue;
      constrained++;
      expect({ value, spans: exprs(value) }).toEqual({ value, spans: old });
      // …and the parser agrees with V8 that each of them is an expression.
      expect(
        exprSegments(tokenizeTemplate(value)).every((seg) => seg.parsed),
      ).toBe(true);
    }
    // The generator must actually exercise the property.
    expect(constrained).toBeGreaterThan(500);
  });

  it('the corpus strings tokenize exactly as before', () => {
    const corpus = [
      'Summarize {{ nodes.fetch.output }} for {{ input.city }}',
      '{{ nodes.triage.output?.summary ?? null }}',
      '{{ nodes.propose.output ?? [] }}',
      '{{ input.kind === "item" }}',
      '{{ nodes.list.output.items.filter(i => i.open).length }}',
      'Item {{ item.name }} ({{ index }})',
    ];
    for (const value of corpus) expect(exprs(value)).toEqual(legacy(value));
  });
});
