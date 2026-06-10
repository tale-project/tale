import type { Element, Root, Text } from 'hast';
import { describe, expect, it } from 'vitest';

import { splitClauseChunks } from './clause-boundaries';
import { rehypeRevealSegments } from './rehype-reveal-segments';

function el(tagName: string, children: Element['children']): Element {
  return { type: 'element', tagName, properties: {}, children };
}

function text(value: string): Text {
  return { type: 'text', value };
}

function root(children: Root['children']): Root {
  return { type: 'root', children };
}

function run(tree: Root): Root {
  rehypeRevealSegments()(tree);
  return tree;
}

function textOf(node: Element | Root): string {
  let out = '';
  for (const child of node.children) {
    if (child.type === 'text') out += child.value;
    else if (child.type === 'element') out += textOf(child);
  }
  return out;
}

describe('splitClauseChunks', () => {
  it('splits at separators followed by whitespace, keeping them attached', () => {
    expect(splitClauseChunks('Hello there, how are you? Fine.')).toEqual([
      'Hello there, ',
      'how are you? ',
      'Fine.',
    ]);
  });

  it('does not split numbers', () => {
    expect(splitClauseChunks('Pi is 3.14 and 1,000 things')).toEqual([
      'Pi is 3.14 and 1,000 things',
    ]);
  });

  it('splits at fullwidth CJK punctuation without requiring whitespace', () => {
    expect(splitClauseChunks('你好，世界。完')).toEqual([
      '你好，',
      '世界。',
      '完',
    ]);
  });

  it('round-trips: chunks concatenate to the input', () => {
    const input = 'One, two. Three! Four? Five: six; seven';
    expect(splitClauseChunks(input).join('')).toBe(input);
  });
});

describe('rehypeRevealSegments', () => {
  it('wraps paragraph text in stream-seg spans, preserving the text', () => {
    const tree = root([el('p', [text('Hello there, how are you?')])]);
    run(tree);
    const p = tree.children[0];
    if (p.type !== 'element') throw new Error('expected element');
    expect(
      p.children.every(
        (c) =>
          c.type === 'element' &&
          c.tagName === 'span' &&
          Array.isArray(c.properties?.className) &&
          c.properties.className.includes('stream-seg'),
      ),
    ).toBe(true);
    expect(textOf(p)).toBe('Hello there, how are you?');
  });

  it('leaves code blocks untouched (raw text extraction must keep working)', () => {
    const code = el('code', [text('const a = 1, b = 2;')]);
    const tree = root([el('pre', [code])]);
    run(tree);
    expect(code.children).toHaveLength(1);
    expect(code.children[0].type).toBe('text');
  });

  it('preserves inline elements between wrapped text chunks', () => {
    const strong = el('strong', [text('bold, text')]);
    const tree = root([el('p', [text('Before, '), strong, text(' after.')])]);
    run(tree);
    const p = tree.children[0];
    if (p.type !== 'element') throw new Error('expected element');
    expect(textOf(p)).toBe('Before, bold, text after.');
    // The strong element survives in place (its own text gets wrapped too).
    expect(
      p.children.some((c) => c.type === 'element' && c.tagName === 'strong'),
    ).toBe(true);
  });

  it('is idempotent — running twice never double-wraps', () => {
    const tree = root([el('p', [text('Hello there, friend.')])]);
    run(tree);
    const once = JSON.stringify(tree);
    run(tree);
    expect(JSON.stringify(tree)).toBe(once);
  });
});
