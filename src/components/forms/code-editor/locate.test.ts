import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';

import { locateJsonPointer, locateYamlPointer } from './locate';

function slice(text: string, range: { from: number; to: number } | null) {
  return range === null ? null : text.slice(range.from, range.to);
}

describe('locateJsonPointer', () => {
  const text = JSON.stringify(
    {
      to: 'ada@example.com',
      nested: { list: [1, { deep: true }] },
      'a/b': 'slash',
      'c~d': 'tilde',
    },
    null,
    2,
  );

  it('finds a value by pointer, nested and in arrays', () => {
    expect(slice(text, locateJsonPointer(text, '/to'))).toBe(
      '"ada@example.com"',
    );
    expect(slice(text, locateJsonPointer(text, '/nested/list/1/deep'))).toBe(
      'true',
    );
    expect(slice(text, locateJsonPointer(text, ''))).toBe(text);
  });

  it('decodes ~1 and ~0 in pointer segments', () => {
    expect(slice(text, locateJsonPointer(text, '/a~1b'))).toBe('"slash"');
    expect(slice(text, locateJsonPointer(text, '/c~0d'))).toBe('"tilde"');
  });

  it('marks a key or, for a missing member, the key of its object', () => {
    expect(
      slice(text, locateJsonPointer(text, '/to', { subject: 'key' })),
    ).toBe('"to"');
    expect(
      slice(
        text,
        locateJsonPointer(text, '/nested/nope', { subject: 'missing' }),
      ),
    ).toBe('"nested"');
    expect(
      slice(text, locateJsonPointer(text, '/nope', { subject: 'missing' })),
    ).toBe('{');
  });

  it('maps a range in the decoded string onto the raw text', () => {
    const raw = '{"a": "x\\"y\\n\\u00e9z\\ud83d\\ude00!"}';
    const decoded = JSON.parse(raw).a as string;
    expect(decoded).toBe('x"y\néz😀!');
    // "éz" in the decoded value
    const start = decoded.indexOf('é');
    expect(
      slice(raw, locateJsonPointer(raw, '/a', { range: [start, start + 2] })),
    ).toBe('\\u00e9z');
    // the emoji: two UTF-16 units, two escapes
    const emoji = decoded.indexOf('😀');
    expect(
      slice(raw, locateJsonPointer(raw, '/a', { range: [emoji, emoji + 2] })),
    ).toBe('\\ud83d\\ude00');
  });

  it('answers null for text that does not parse or a pointer to nothing', () => {
    expect(locateJsonPointer('{"a": ', '/a')).toBeNull();
    expect(locateJsonPointer(text, '/nope')).toBeNull();
    expect(locateJsonPointer(text, 'no-slash')).toBeNull();
  });

  // Whatever a value holds, the raw text at the mapped range decodes back
  // to exactly the decoded substring that was asked for.
  it('round-trips ranges through JSON.stringify', () => {
    const samples = [
      'plain text',
      'quote " and backslash \\ inside',
      'tab\tnew\nline',
      'ümlaut é 😀 emoji',
      '{{ nodes.a.output }} and {{ "}}" }}',
      '\u0001 control',
    ];
    for (const value of samples) {
      const raw = JSON.stringify({ v: value });
      for (let from = 0; from < value.length; from++) {
        for (let to = from + 1; to <= value.length; to++) {
          // Never split a surrogate pair.
          if (/[\ud800-\udbff]/.test(value[to - 1] ?? '')) continue;
          if (/[\udc00-\udfff]/.test(value[from] ?? '')) continue;
          const found = locateJsonPointer(raw, '/v', { range: [from, to] });
          expect(found).not.toBeNull();
          const piece = raw.slice(found?.from, found?.to);
          expect(JSON.parse(`"${piece}"`)).toBe(value.slice(from, to));
        }
      }
    }
  });
});

describe('locateYamlPointer', () => {
  const text = [
    'name: Triage',
    'nodes:',
    '  - id: score',
    '    prompt: Rate {{ item.title }} now',
    "    single: 'it''s {{ x }}'",
    '    double: "say {{ y }}"',
    '    escaped: "tab\\there {{ z }}"',
    '    code: |',
    '      const a = 1;',
    '      return {{ w }};',
    '    folded: >',
    '      one',
    '      two {{ v }}',
    '    flow: { a: 1, b: "{{ u }}" }',
  ].join('\n');

  it('finds a value by pointer', () => {
    expect(slice(text, locateYamlPointer(text, '/name'))).toBe('Triage');
    expect(slice(text, locateYamlPointer(text, '/nodes/0/id'))).toBe('score');
    expect(slice(text, locateYamlPointer(text, '/nodes/0/flow/b'))).toBe(
      '"{{ u }}"',
    );
  });

  it('marks a key, and the key of the object a missing member belongs to', () => {
    expect(
      slice(text, locateYamlPointer(text, '/nodes/0/id', { subject: 'key' })),
    ).toBe('id');
    // An item has no key of its own: its first key stands in.
    expect(
      slice(
        text,
        locateYamlPointer(text, '/nodes/0/missing', { subject: 'missing' }),
      ),
    ).toBe('id');
    expect(locateYamlPointer(text, '/missing', { subject: 'missing' })).toBe(
      null,
    );
    expect(
      slice(text, locateYamlPointer(text, '/name/x', { subject: 'missing' })),
    ).toBe('name');
  });

  it.each([
    ['/nodes/0/prompt', 'Rate {{ item.title }} now', '{{ item.title }}'],
    ['/nodes/0/single', "it's {{ x }}", '{{ x }}'],
    ['/nodes/0/double', 'say {{ y }}', '{{ y }}'],
    ['/nodes/0/code', 'const a = 1;\nreturn {{ w }};\n', '{{ w }}'],
    ['/nodes/0/folded', 'one two {{ v }}\n', '{{ v }}'],
  ])('maps a range inside %s exactly', (pointer, decoded, part) => {
    const at = decoded.indexOf(part);
    const found = locateYamlPointer(text, pointer, {
      range: [at, at + part.length],
    });
    expect(slice(text, found)).toBe(part);
  });

  it('marks a whole escaped value rather than guess inside it', () => {
    const found = locateYamlPointer(text, '/nodes/0/escaped', {
      range: [9, 16],
    });
    expect(slice(text, found)).toBe('"tab\\there {{ z }}"');
  });

  it('answers null for YAML that does not parse', () => {
    expect(locateYamlPointer('a: [1, 2', '/a')).toBeNull();
  });

  // Values written by `yaml.stringify` as plain or block scalars: the text
  // at a mapped range is the decoded substring, give or take the
  // indentation a block scalar adds to each line.
  it('round-trips ranges through yaml.stringify', () => {
    const samples = [
      'plain value with {{ nodes.a.output }}',
      'two\nlines {{ x }}\nthree',
      "it's quoted: {{ y }}",
    ];
    for (const value of samples) {
      const raw = stringify({ v: value }, { lineWidth: 0 });
      for (let from = 0; from < value.length; from++) {
        for (let to = from + 1; to <= value.length; to++) {
          const found = locateYamlPointer(raw, '/v', { range: [from, to] });
          expect(found, `${raw} [${from}, ${to})`).not.toBeNull();
          if (found === null) continue;
          const piece = raw
            .slice(found.from, found.to)
            .replace(/\n[ ]+/g, '\n')
            .replace(/''/g, "'");
          expect(piece).toBe(value.slice(from, to));
        }
      }
    }
  });
});
