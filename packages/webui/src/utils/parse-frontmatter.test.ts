import { describe, expect, it } from 'vitest';

import { parseFrontmatter } from './parse-frontmatter';

describe('parseFrontmatter', () => {
  it('returns empty frontmatter and original content when no delimiter', () => {
    const raw = '# Just markdown\n\nNo frontmatter here.\n';
    const result = parseFrontmatter(raw);
    expect(result.frontmatter).toEqual({});
    expect(result.content).toBe(raw);
  });

  it('returns empty frontmatter for empty input', () => {
    const result = parseFrontmatter('');
    expect(result.frontmatter).toEqual({});
    expect(result.content).toBe('');
  });

  it('parses simple unquoted key/value pairs', () => {
    const raw = '---\ntitle: Hello\ndescription: A page\n---\n\nBody text.\n';
    const result = parseFrontmatter(raw);
    expect(result.frontmatter).toEqual({
      title: 'Hello',
      description: 'A page',
    });
    expect(result.content).toBe('Body text.\n');
  });

  it('strips double-quoted strings', () => {
    const raw = '---\ntitle: "Hello, world"\n---\nbody';
    const result = parseFrontmatter(raw);
    expect(result.frontmatter.title).toBe('Hello, world');
  });

  it('strips single-quoted strings', () => {
    const raw = "---\ntitle: 'Hello, world'\n---\nbody";
    const result = parseFrontmatter(raw);
    expect(result.frontmatter.title).toBe('Hello, world');
  });

  it('preserves colons inside quoted values', () => {
    const raw = '---\ntitle: "Hello: world"\n---\nbody';
    const result = parseFrontmatter(raw);
    expect(result.frontmatter.title).toBe('Hello: world');
  });

  it('coerces true / false to booleans', () => {
    const raw = '---\nnoindex: true\ndraft: false\n---\nbody';
    const result = parseFrontmatter(raw);
    expect(result.frontmatter.noindex).toBe(true);
    expect(result.frontmatter.draft).toBe(false);
  });

  it('keeps numeric values as strings', () => {
    const raw = '---\norder: 3\nweight: 0.5\n---\nbody';
    const result = parseFrontmatter(raw);
    expect(result.frontmatter.order).toBe('3');
    expect(result.frontmatter.weight).toBe('0.5');
  });

  it('handles CRLF line endings', () => {
    const raw = '---\r\ntitle: Hello\r\nnoindex: true\r\n---\r\nBody\r\n';
    const result = parseFrontmatter(raw);
    expect(result.frontmatter.title).toBe('Hello');
    expect(result.frontmatter.noindex).toBe(true);
    expect(result.content).toBe('Body\r\n');
  });

  it('strips trailing comments on unquoted values', () => {
    const raw =
      '---\ntitle: Hello # greeting\nnoindex: true # hide it\n---\nbody';
    const result = parseFrontmatter(raw);
    expect(result.frontmatter.title).toBe('Hello');
    expect(result.frontmatter.noindex).toBe(true);
  });

  it('does not treat # without preceding whitespace as a comment', () => {
    const raw = '---\ncolor: #ff0000\n---\nbody';
    const result = parseFrontmatter(raw);
    expect(result.frontmatter.color).toBe('#ff0000');
  });

  it('does not strip # inside quoted strings', () => {
    const raw = '---\ntitle: "Hello # world"\n---\nbody';
    const result = parseFrontmatter(raw);
    expect(result.frontmatter.title).toBe('Hello # world');
  });

  it('skips lines without a colon', () => {
    const raw = '---\ntitle: Hello\nnot a pair\nkey: value\n---\nbody';
    const result = parseFrontmatter(raw);
    expect(result.frontmatter).toEqual({ title: 'Hello', key: 'value' });
  });

  it('skips lines with empty key', () => {
    const raw = '---\n: orphan\ntitle: Hello\n---\nbody';
    const result = parseFrontmatter(raw);
    expect(result.frontmatter).toEqual({ title: 'Hello' });
  });

  it('handles empty values', () => {
    const raw = '---\ntitle:\ndescription: ok\n---\nbody';
    const result = parseFrontmatter(raw);
    expect(result.frontmatter.title).toBe('');
    expect(result.frontmatter.description).toBe('ok');
  });

  it('strips a single leading newline from the body', () => {
    const raw = '---\ntitle: x\n---\n\nFirst paragraph.\n\nSecond.\n';
    const result = parseFrontmatter(raw);
    // Regex consumes one `\r?\n` after closing `---`; the next `\n` is also
    // consumed by the leading-newline strip in the implementation.
    expect(result.content).toBe('First paragraph.\n\nSecond.\n');
  });

  it('preserves a value that is just a single quote character', () => {
    // Length-1 quote-like values should not be stripped (used to slice to '').
    const raw = '---\nquote: "\n---\nbody';
    const result = parseFrontmatter(raw);
    expect(result.frontmatter.quote).toBe('"');
  });

  it('preserves escaped quotes inside double-quoted values literally', () => {
    // The parser does not interpret escape sequences; backslashes pass through.
    const raw = '---\ntitle: "He said \\"hi\\""\n---\nbody';
    const result = parseFrontmatter(raw);
    expect(result.frontmatter.title).toBe('He said \\"hi\\"');
  });

  it('does not parse YAML lists (limitation, not parsed as array)', () => {
    const raw = '---\ntitle: Hello\ntags:\n- one\n- two\n---\nbody';
    const result = parseFrontmatter(raw);
    expect(result.frontmatter.title).toBe('Hello');
    // tags becomes empty string; "- one" / "- two" are skipped (no colon).
    expect(result.frontmatter.tags).toBe('');
    expect(Object.keys(result.frontmatter)).toEqual(['title', 'tags']);
  });

  it('does not interpret block scalars (>, |) — limitation', () => {
    const raw = '---\nsummary: |\n  line one\n  line two\n---\nbody';
    const result = parseFrontmatter(raw);
    // The `|` is captured as the literal value; subsequent indented lines are
    // skipped because they have no colon.
    expect(result.frontmatter.summary).toBe('|');
  });

  it('handles frontmatter with trailing CRLF after closing delimiter', () => {
    const raw = '---\r\ntitle: x\r\n---\r\n';
    const result = parseFrontmatter(raw);
    expect(result.frontmatter.title).toBe('x');
    expect(result.content).toBe('');
  });

  it('returns empty frontmatter object when block has only a blank line', () => {
    // The opening and closing `---` must each be on their own line, separated
    // by at least one newline — so a single blank line counts as an empty block.
    const raw = '---\n\n---\nbody';
    const result = parseFrontmatter(raw);
    expect(result.frontmatter).toEqual({});
    expect(result.content).toBe('body');
  });
});
