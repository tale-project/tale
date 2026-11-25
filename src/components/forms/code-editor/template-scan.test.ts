import { describe, expect, it } from 'vitest';

import { scanTemplates } from './template-scan';

/** The text of each template and whether it balanced. */
function templates(text: string): Array<[string, boolean]> {
  return scanTemplates(text).spans.map((span) => [
    text.slice(span.open, span.end),
    span.balanced,
  ]);
}

describe('scanTemplates', () => {
  it('finds each template with its body', () => {
    const text = 'Hi {{ input.name }}, see {{nodes.a.output}}.';
    const { spans, unterminated } = scanTemplates(text);
    expect(unterminated).toEqual([]);
    expect(spans).toHaveLength(2);
    const [first, second] = spans;
    expect(text.slice(first.bodyFrom, first.bodyTo)).toBe(' input.name ');
    expect(text.slice(second.bodyFrom, second.bodyTo)).toBe('nodes.a.output');
    expect(text.slice(second.end)).toBe('.');
  });

  // The engine's own cases (P1 `tokenizeTemplate`): a template ends at the
  // `}}` that closes its expression.
  it.each([
    ['{{ xs.map(x => ({ y: x })) }}', '{{ xs.map(x => ({ y: x })) }}'],
    ['{{ ({ a: { b: 1 } }) }} tail', '{{ ({ a: { b: 1 } }) }}'],
    ['{{ "}}" }} tail', '{{ "}}" }}'],
    ["{{ '}}' + `}}` }}", "{{ '}}' + `}}` }}"],
    ['{{ `${a}}` }}', '{{ `${a}}` }}'],
    ['{{ x // }} }}', '{{ x // }}'],
    ['{{ a }}}', '{{ a }}'],
  ])('%s', (text, expected) => {
    expect(templates(text)[0]).toEqual([expected, true]);
  });

  it('keeps the first closer when nothing balanced fits, and says so', () => {
    expect(templates('{{ a) }} b')).toEqual([['{{ a) }}', false]]);
    expect(templates('{{ }} b')).toEqual([['{{ }}', false]]);
  });

  it('lists a {{ with no closer after it as unterminated', () => {
    const text = 'a {{ b }} c {{ d';
    const { spans, unterminated } = scanTemplates(text);
    expect(spans.map((span) => text.slice(span.open, span.end))).toEqual([
      '{{ b }}',
    ]);
    expect(unterminated).toEqual([[12, 14]]);
  });

  it('leaves an empty {{}} as quiet text', () => {
    expect(scanTemplates('a {{}} b')).toEqual({ spans: [], unterminated: [] });
  });

  // Generated identifier and member templates always round-trip: one span
  // per template, covering it exactly.
  it('round-trips generated member templates', () => {
    const names = ['nodes', 'input', 'item', 'a_b', '$x', 'output'];
    let seed = 7;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    for (let run = 0; run < 200; run++) {
      const parts: string[] = [];
      const expected: string[] = [];
      for (let i = 0; i < 1 + (next() % 4); i++) {
        const chain = Array.from(
          { length: 1 + (next() % 4) },
          () => names[next() % names.length],
        ).join(next() % 2 === 0 ? '.' : '?.');
        const template = `{{ ${chain} }}`;
        expected.push(template);
        parts.push(`text ${i} `, template);
      }
      const text = parts.join('');
      expect(templates(text).map(([found]) => found)).toEqual(expected);
    }
  });
});
