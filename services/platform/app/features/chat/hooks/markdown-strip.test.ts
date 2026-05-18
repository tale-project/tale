import { describe, expect, it } from 'vitest';

import {
  containsNormalized,
  stripMarkdown,
  stripMarkdownOnce,
} from './markdown-strip';

describe('stripMarkdownOnce', () => {
  it('drops bold and italic markers but keeps the visible text', () => {
    expect(stripMarkdownOnce('Hello **world** and _friends_')).toBe(
      'Hello world and friends',
    );
  });

  it('keeps the visible text of links and images, drops their targets', () => {
    expect(stripMarkdownOnce('Read [the docs](https://example.com).')).toBe(
      'Read the docs.',
    );
    expect(stripMarkdownOnce('![alt text](https://example.com/x.png)')).toBe(
      'alt text',
    );
  });

  it('drops heading hashes and blockquote prefixes', () => {
    expect(stripMarkdownOnce('# Heading')).toBe('Heading');
    expect(stripMarkdownOnce('> a quoted line')).toBe('a quoted line');
  });

  it('strips emoji including transport and supplemental symbols', () => {
    expect(stripMarkdownOnce('Hi 😀 there ⚓ now')).toBe('Hi there now');
  });

  it('collapses runs of whitespace and trims', () => {
    expect(stripMarkdownOnce('  spaced   out   text  ')).toBe(
      'spaced out text',
    );
  });
});

describe('stripMarkdown (with fence state)', () => {
  it('drops fenced code blocks entirely', () => {
    const fence = { current: false };
    const input = 'Before\n```\ncode goes here\n```\nAfter';
    expect(stripMarkdown(input, fence)).toBe('Before After');
    expect(fence.current).toBe(false);
  });

  it('tracks fence state across calls when a fence opens mid-stream', () => {
    const fence = { current: false };
    expect(stripMarkdown('Hello\n```js', fence)).toBe('Hello');
    expect(fence.current).toBe(true);
    expect(stripMarkdown('console.log(1);', fence)).toBe('');
    expect(stripMarkdown('```\nGoodbye', fence)).toBe('Goodbye');
    expect(fence.current).toBe(false);
  });

  it('also drops `~~~` fences (CommonMark tilde variant)', () => {
    const fence = { current: false };
    const input = 'Before\n~~~\ncode\n~~~\nAfter';
    expect(stripMarkdown(input, fence)).toBe('Before After');
  });

  it('drops 4-space indented code blocks', () => {
    expect(stripMarkdownOnce('Intro\n\n    code line\nOutro')).toBe(
      'Intro Outro',
    );
  });
});

describe('adversarial input regression tests', () => {
  it('does not mangle intra-word underscore emphasis (snake_case)', () => {
    // Pre-fix bug: `(\*|_)(.+?)\1` matched `_case_` and produced
    // `snakecasevar`. CommonMark requires `_` emphasis to be at a word
    // boundary. The tightened regex preserves the underscores.
    expect(stripMarkdownOnce('snake_case_var stays intact')).toBe(
      'snake_case_var stays intact',
    );
  });

  it('still strips boundary-anchored underscore emphasis', () => {
    expect(stripMarkdownOnce('Hello _world_ goodbye')).toBe(
      'Hello world goodbye',
    );
  });

  it('drops autolinks `<https://...>` and bare URLs', () => {
    expect(stripMarkdownOnce('See <https://example.com/foo> here')).toBe(
      'See here',
    );
    expect(stripMarkdownOnce('Go to https://example.com/x?y=1 now')).toBe(
      'Go to now',
    );
  });

  it('collapses table rows to whitespace (no pipes read aloud)', () => {
    const table = '| Cell A | Cell B |\n| ------ | ------ |\n| Row 1 | Row 2 |';
    const result = stripMarkdownOnce(table);
    expect(result).not.toContain('|');
    expect(result).toContain('Cell A');
    expect(result).toContain('Row 1');
  });

  it('strips inline and block math entirely', () => {
    expect(stripMarkdownOnce('Pythagoras: $a^2 + b^2 = c^2$ is famous.')).toBe(
      'Pythagoras: is famous.',
    );
    expect(stripMarkdownOnce('Before\n$$\nE = mc^2\n$$\nAfter')).toBe(
      'Before After',
    );
  });

  it('preserves currency amounts that look like inline-math delimiters', () => {
    // Regression: pre-fix the inline-math regex matched `$5 for $` as a
    // single math span, collapsing `"I paid $5 for $10 of beans"` to
    // `"I paid 10 of beans"`. Gating the opener on non-digit fixes this.
    expect(stripMarkdownOnce('I paid $5 for $10 of beans.')).toBe(
      'I paid $5 for $10 of beans.',
    );
    expect(stripMarkdownOnce('Subtotal $1,000 plus $25 shipping.')).toBe(
      'Subtotal $1,000 plus $25 shipping.',
    );
    expect(stripMarkdownOnce('It costs $5.99 today.')).toBe(
      'It costs $5.99 today.',
    );
  });

  it('still strips LaTeX commands that start with a backslash or letter', () => {
    expect(
      stripMarkdownOnce('Greek: $\\alpha + \\beta = \\gamma$ inline.'),
    ).toBe('Greek: inline.');
    expect(stripMarkdownOnce('Var $x$ and $y$ are reals.')).toBe(
      'Var and are reals.',
    );
  });

  it('drops <script> and <style> block bodies (not just the tag wrappers)', () => {
    // Regression: the previous generic-tag stripper only removed
    // `<script>` open/close tokens, leaving `alert(1)` to be vocalized
    // by TTS. Same for `<style>` CSS bodies.
    expect(stripMarkdownOnce('Hello <script>alert(1)</script> world.')).toBe(
      'Hello world.',
    );
    expect(
      stripMarkdownOnce('Before\n<style>body { color: red; }</style>\nAfter'),
    ).toBe('Before After');
    // Multi-line bodies must also be dropped.
    expect(
      stripMarkdownOnce(
        'pre <script type="text/javascript">\n  doStuff();\n</script> post',
      ),
    ).toBe('pre post');
  });

  it('keeps strikethrough content', () => {
    expect(stripMarkdownOnce('This is ~~deleted text~~ ok.')).toBe(
      'This is deleted text ok.',
    );
  });

  it('drops task-list checkboxes', () => {
    expect(
      stripMarkdownOnce('- [ ] todo one\n- [x] done two\n- regular three'),
    ).toBe('todo one done two regular three');
  });

  it('strips HTML tags and decodes common entities', () => {
    expect(
      stripMarkdownOnce('<strong>bold</strong> &amp; <em>italic</em>'),
    ).toBe('bold & italic');
    expect(stripMarkdownOnce('a&nbsp;b&#39;c')).toBe("a b'c");
  });

  it('drops footnote references', () => {
    expect(stripMarkdownOnce('See note[^1] here.')).toBe('See note here.');
  });
});

describe('containsNormalized', () => {
  it('matches when haystack contains needle ignoring whitespace runs', () => {
    expect(containsNormalized('Hello  world  friend', 'world friend')).toBe(
      true,
    );
  });

  it('returns false when needle is not present', () => {
    expect(containsNormalized('Hello world', 'goodbye')).toBe(false);
  });

  it('returns false for empty needle to avoid spurious all-match', () => {
    expect(containsNormalized('Hello world', '')).toBe(false);
    expect(containsNormalized('Hello world', '   ')).toBe(false);
  });

  it('normalises whitespace on both sides before matching', () => {
    expect(containsNormalized('Hello\n\nworld\tfriend', 'world friend')).toBe(
      true,
    );
  });

  it('paragraph-spotlight scenario: stripped paragraph vs. stripped chunk', () => {
    const paragraph = stripMarkdownOnce(
      "Hi! I'm **doing well**, thank you. Hope you're having a great day too! 😊",
    );
    const chunkText = stripMarkdownOnce(
      "Hi! I'm doing well, thank you. Hope you're having a great day too!",
    );
    expect(containsNormalized(paragraph, chunkText)).toBe(true);
  });

  it('paragraph-spotlight scenario: chunk text not in another paragraph', () => {
    const otherParagraph = stripMarkdownOnce('How can I help you today?');
    const chunkText = stripMarkdownOnce(
      "Hi! I'm doing well, thank you. Hope you're having a great day too!",
    );
    expect(containsNormalized(otherParagraph, chunkText)).toBe(false);
  });
});
