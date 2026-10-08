import { locateYamlPointer } from '@tale/ui/code-editor/locate';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { sourceFileName, yamlSource } from './yaml-source';

const DOCUMENT = {
  version: 1,
  name: 'support/triage',
  description: 'Sorts the inbox: "urgent" first.',
  inputs: {
    type: 'object',
    properties: { owner: { type: 'string' } },
    required: ['owner'],
  },
  nodes: [
    {
      id: 'score',
      type: 'transform',
      code: 'const n = input.items.length;\nreturn { n };\n',
      input: { items: '{{ nodes.fetch.output }}' },
      // A key this build has no control for stays where it was written.
      credential: 'github-main',
    },
    {
      id: 'reply',
      type: 'llm',
      prompt: 'Line one\n  indented line\n\nLast: {{ nodes.score.output.n }}',
      when: '{{ nodes.score.output.n > 0 }}',
    },
  ],
  output: { summary: '{{ nodes.reply.output }}', empty: null, flags: [] },
  tests: [{ name: 'empty inbox', input: { owner: 'acme' } }],
  ui: { positions: { score: { x: 0, y: 0 } } },
};

describe('yamlSource', () => {
  it('reads back as the document, key for key and value for value', () => {
    expect(parse(yamlSource(DOCUMENT))).toEqual(DOCUMENT);
  });

  it('gives the same text for the same document every time', () => {
    expect(yamlSource(DOCUMENT)).toBe(yamlSource(structuredClone(DOCUMENT)));
  });

  it('keeps the stored key order and every key, ui and tests included', () => {
    const text = yamlSource(DOCUMENT);
    const topLevel = [...text.matchAll(/^([a-z]+):/gm)].map(
      (match) => match[1],
    );
    expect(topLevel).toEqual(Object.keys(DOCUMENT));
    expect(text).toContain('credential: github-main');
  });

  it('writes multi-line code and prompts as literal blocks, never folded', () => {
    const text = yamlSource(DOCUMENT);
    expect(text).toContain('code: |\n');
    expect(text).toContain('      const n = input.items.length;\n');
    const long = {
      name: 'a',
      nodes: [{ id: 'x', type: 'llm', prompt: 'word '.repeat(60).trim() }],
    };
    const line = yamlSource(long)
      .split('\n')
      .find((each) => each.includes('prompt:'));
    expect(line).toBe(`    prompt: ${'word '.repeat(60).trim()}`);
  });

  it('places a problem at the characters it names', () => {
    const text = yamlSource(DOCUMENT);
    const located = locateYamlPointer(text, '/nodes/1/when', { range: [3, 8] });
    expect(located).not.toBeNull();
    expect(text.slice(located?.from, located?.to)).toBe('nodes');
    const test = locateYamlPointer(text, '/tests/0/name');
    expect(text.slice(test?.from, test?.to)).toBe('empty inbox');
  });
});

describe('sourceFileName', () => {
  it('names the file after the automation, its version and a draft', () => {
    expect(sourceFileName('support/triage', 4, false)).toBe(
      'support__triage-v4.yml',
    );
    expect(sourceFileName('support/triage', 4, true)).toBe(
      'support__triage-v4-draft.yml',
    );
    expect(sourceFileName('triage', undefined, true)).toBe('triage-draft.yml');
  });
});
