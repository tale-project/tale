import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { scanTemplates } from '@tale/ui/code-editor/template-scan';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { engineTemplateScan } from './template-scanner';

/**
 * `@tale/ui`'s template scanner decides where a `{{ … }}` ends without a
 * JavaScript parser ("balanced" for "parses"); the engine's tokenizer, which
 * the run evaluates with, uses one. The editor hands the engine's rule to
 * the code editor, and every other host of the editor relies on the
 * package's. These tests hold the two to the same spans on every template
 * the shipped automations hold and on 10 000 generated texts of valid
 * expressions — strings holding `}}`, object literals, arrow bodies,
 * template literals — so the package's rule cannot drift from the
 * runtime's for anything an author writes.
 *
 * They differ on purpose only where "balanced" and "parses" part ways: a
 * regular expression holding `}}`, a line comment, and a span that is
 * balanced but not an expression. The generator writes none of them.
 */

/** The spans as both scanners must agree on them. */
function shape(scan: ReturnType<typeof scanTemplates>) {
  return {
    spans: scan.spans.map((span) => [span.open, span.end]),
    unterminated: scan.unterminated,
  };
}

function expectSame(text: string): void {
  expect(shape(scanTemplates(text)), JSON.stringify(text)).toEqual(
    shape(engineTemplateScan(text)),
  );
}

const REPO = path.resolve(import.meta.dirname, '../../../../../..');
const SHIPPED = path.join(REPO, 'configs/platform/custom/automations');

function documentFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return documentFiles(full);
    return name === 'workflow.yml' ? [full] : [];
  });
}

function templatedStrings(value: unknown): string[] {
  if (typeof value === 'string') return value.includes('{{') ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(templatedStrings);
  if (value !== null && typeof value === 'object') {
    return Object.values(value).flatMap(templatedStrings);
  }
  return [];
}

describe('the package scanner and the engine tokenizer', () => {
  it('agree on every template the shipped automations hold', () => {
    const files = documentFiles(SHIPPED);
    expect(files.length).toBeGreaterThan(0);
    const strings = files.flatMap((file) =>
      templatedStrings(parse(readFileSync(file, 'utf8'))),
    );
    expect(strings.length).toBeGreaterThan(50);
    for (const text of strings) expectSame(text);
  });

  it.each([
    'plain text',
    '{{ input.name }}',
    'Hi {{ input.name }}, {{ nodes.score.output.total > 3 ? "high" : "low" }}.',
    '{{ xs.map(x => ({ y: x })) }}',
    '{{ "a }} b" }} tail',
    "{{ '{{ not a template }}' }}",
    '{{ `a ${nodes.a.output.x} }} b` }}',
    '{{ ({ a: { b: 1 } }) }}',
    '{{ [1, [2, [3]]].flat(2) }}',
    '{{ a }}}',
    '{{}} stays text',
    '{{ unterminated',
    'before {{ a }} {{ b',
    '{{ a }}{{ b }}',
    '{{ nodes.list.output.filter((i) => { return i.ok; }).length }}',
  ])('agree on %j', (text) => {
    expectSame(text);
  });
});

/** A small seeded generator, so a failure names a reproducible text. */
function generator(seed: number) {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(items: readonly T[]): T => {
    const item = items[Math.floor(next() * items.length)];
    if (item === undefined) throw new Error('empty choice');
    return item;
  };
  const space = () => pick(['', ' ', '  ', '\n']);

  const expr = (depth: number): string => {
    if (depth <= 0) {
      return pick([
        'input.name',
        'nodes.a.output.total',
        'item',
        'index',
        '42',
        '"}}"',
        "'{{ x }}'",
        '"a"',
        'true',
        'null',
      ]);
    }
    const inner = () => expr(depth - 1);
    switch (Math.floor(next() * 11)) {
      case 0:
        return `{${space()}k:${space()}${inner()}${space()}}`;
      case 1:
        return `[${inner()},${space()}${inner()}]`;
      case 2:
        return `f(${inner()})`;
      case 3:
        return `xs.map((x) => ({ y: ${inner()} }))`;
      case 4:
        return `xs.map((x) => { return ${inner()}; })`;
      case 5:
        return `\`t\${${inner()}}}\``;
      case 6:
        return `${inner()} ? ${inner()} : ${inner()}`;
      case 7:
        return `${inner()} + ${inner()}`;
      case 8:
        return `(${inner()})`;
      case 9:
        return `(${inner()}).length`;
      default:
        return `{${space()}${pick(['a', '"b c"'])}:${space()}{ d: ${inner()} }${space()}}`;
    }
  };

  const text = (): string => {
    const parts: string[] = [];
    const count = 1 + Math.floor(next() * 3);
    for (let i = 0; i < count; i++) {
      parts.push(pick(['', 'Hello ', 'a } b ', 'x: ', '\n', '} ', ' { ', ' ']));
      parts.push(`{{${space()}${expr(Math.floor(next() * 4))}${space()}}}`);
    }
    parts.push(pick(['', '.', ' }', ' {{ open', ' tail']));
    return parts.join('');
  };
  return { text };
}

describe('engineTemplateScan', () => {
  it('marks a span the engine could not read as an expression, as the run reports it', () => {
    expect(engineTemplateScan('{{ a b }} and {{ c }}').spans).toEqual([
      { open: 0, bodyFrom: 2, bodyTo: 7, end: 9, balanced: false },
      { open: 14, bodyFrom: 16, bodyTo: 19, end: 21, balanced: true },
    ]);
  });

  it('follows the run where the package rule cannot: a regular expression holding the closer', () => {
    const text = '{{ /}}/.test(a) }}';
    expect(engineTemplateScan(text).spans.map((span) => span.end)).toEqual([
      18,
    ]);
    expect(scanTemplates(text).spans.map((span) => span.end)).toEqual([6]);
  });

  it('agrees with the package on a block comment holding the closer', () => {
    expectSame('{{ a /* }} */ }}');
  });
});

describe('generated texts', () => {
  it('agree on 10 000 texts of valid expressions', () => {
    const { text } = generator(20261008);
    for (let i = 0; i < 10_000; i++) expectSame(text());
  });
});
