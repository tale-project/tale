import { describe, expect, it } from 'vitest';

import { parseFrontmatter } from './parse-frontmatter';

describe('parseFrontmatter', () => {
  it('parses a simple frontmatter block', () => {
    const { frontmatter, content } = parseFrontmatter(
      '---\ntitle: Hello\ndescription: World\n---\nbody text\n',
    );
    expect(frontmatter).toEqual({ title: 'Hello', description: 'World' });
    expect(content).toBe('body text\n');
  });

  it('returns empty frontmatter when no block is present', () => {
    const raw = '# Just body\n\nno frontmatter here';
    const { frontmatter, content } = parseFrontmatter(raw);
    expect(frontmatter).toEqual({});
    expect(content).toBe(raw);
  });

  it('coerces true/false literals to booleans', () => {
    const { frontmatter } = parseFrontmatter(
      '---\nnoindex: true\npublished: false\n---\n',
    );
    expect(frontmatter).toEqual({ noindex: true, published: false });
  });

  it('keeps quoted strings as strings even when they look like booleans', () => {
    const { frontmatter } = parseFrontmatter(
      '---\nflag: "true"\nother: \'false\'\n---\n',
    );
    expect(frontmatter).toEqual({ flag: 'true', other: 'false' });
  });

  it('strips YAML-style trailing comments on unquoted values', () => {
    const { frontmatter } = parseFrontmatter(
      '---\ntitle: Hello # a comment\n---\n',
    );
    expect(frontmatter.title).toBe('Hello');
  });

  it('preserves "#" inside quoted values', () => {
    const { frontmatter } = parseFrontmatter(
      '---\ncolor: "#fff # not a comment"\n---\n',
    );
    expect(frontmatter.color).toBe('#fff # not a comment');
  });

  it('skips lines without a colon', () => {
    const { frontmatter } = parseFrontmatter(
      '---\nfoo: bar\njust some line\nbaz: qux\n---\n',
    );
    expect(frontmatter).toEqual({ foo: 'bar', baz: 'qux' });
  });

  it('handles CRLF line endings', () => {
    const { frontmatter, content } = parseFrontmatter(
      '---\r\ntitle: Hi\r\n---\r\nhello\r\n',
    );
    expect(frontmatter).toEqual({ title: 'Hi' });
    expect(content).toBe('hello\r\n');
  });

  it('trims surrounding whitespace from key and value', () => {
    const { frontmatter } = parseFrontmatter('---\n  key  :   value   \n---\n');
    expect(frontmatter).toEqual({ key: 'value' });
  });

  it('returns body unchanged when only frontmatter is present', () => {
    const { frontmatter, content } = parseFrontmatter('---\nfoo: bar\n---\n');
    expect(frontmatter).toEqual({ foo: 'bar' });
    expect(content).toBe('');
  });
});
