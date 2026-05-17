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
