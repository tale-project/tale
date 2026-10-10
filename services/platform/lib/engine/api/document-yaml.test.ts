// @vitest-environment node

import { randomJson, seeded } from '@tale/ui/data/random-json';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';

import { yamlSource } from '@/app/features/automations/lib/yaml-source';

import { shippedDocuments } from '../selftest/corpus';
import { documentYaml } from './document-yaml';

/**
 * The Source view's text as the editor rendered it before the rendering
 * moved into the engine — kept as the oracle that the move changed no byte.
 */
function sourceViewText(document: unknown): string {
  return stringify(document, {
    schema: 'core',
    indent: 2,
    lineWidth: 0,
    blockQuote: 'literal',
    aliasDuplicateObjects: false,
  });
}

/** Strings YAML is easy to get wrong with. */
const AWKWARD = {
  name: 'edge/cases',
  nodes: [
    {
      id: 'text',
      type: 'llm',
      prompt: '  leading spaces\ntrailing newline\n',
      system: '# not a comment: {{ input.x }} - [a, b]',
      input: {
        yes: 'yes',
        number: '0123',
        empty: '',
        nothing: null,
        colon: 'a: b',
        quote: 'it\'s "quoted"',
        unicode: 'Zürich 😀  nbsp',
        tabs: 'a\tb',
        crlf: 'one\r\ntwo',
        long: 'word '.repeat(80),
      },
      code: 'return 1;\n\n\n',
    },
  ],
  output: { list: [[1, [2]], { a: [] }, {}], when: true },
};

describe('documentYaml', () => {
  const documents = shippedDocuments();

  it('is the very function the Source view shows', () => {
    expect(yamlSource).toBe(documentYaml);
  });

  it.each(documents.map(({ label, document }) => [label, document] as const))(
    '%s: renders byte for byte the Source view text',
    (_, document) => {
      expect(documentYaml(document)).toBe(sourceViewText(document));
    },
  );

  it('renders awkward strings and random data as the Source view did, and reads back', () => {
    const random = seeded(4_242);
    const samples: unknown[] = [AWKWARD];
    for (let at = 0; at < 200; at += 1) {
      samples.push({
        name: `r${at}`,
        nodes: [],
        output: randomJson(random, 4),
      });
    }
    for (const sample of samples) {
      const text = documentYaml(sample as Record<string, unknown>);
      expect(text).toBe(sourceViewText(sample));
      expect(parse(text)).toEqual(sample);
    }
  });

  it('writes a value the document repeats out each time, never as an alias', () => {
    const shared = { owner: 'acme' };
    const text = documentYaml({
      name: 'a',
      nodes: [],
      tests: [
        { name: 'one', input: shared },
        { name: 'two', input: shared },
      ],
    });
    expect(text).not.toMatch(/[&*]\w/);
    expect(text.match(/owner: acme/g)).toHaveLength(2);
  });
});
