import { describe, expect, test } from 'bun:test';

import { checkFrontmatter } from '../src/guards';
import { type FileTree } from '../src/tree';

/** Build a FileTree from a plain object (utf-8 encoded values). */
function tree(entries: Record<string, string>): FileTree {
  const map: FileTree = new Map();
  const enc = new TextEncoder();
  for (const [key, value] of Object.entries(entries)) {
    map.set(key, enc.encode(value));
  }
  return map;
}

/** A SKILL.md with the given frontmatter body between `---` fences. */
function skillMd(frontmatter: string): FileTree {
  return tree({ 'SKILL.md': `---\n${frontmatter}\n---\n\n# Body\n` });
}

describe('checkFrontmatter', () => {
  test('passes a well-formed name + description', () => {
    const source = skillMd('name: demo\ndescription: A short description.');
    expect(checkFrontmatter('demo', 'demo', source)).toEqual([]);
  });

  test('allows extra keys (e.g. license on the document skills)', () => {
    const source = skillMd(
      'name: docx\ndescription: Work with .docx files.\nlicense: MIT',
    );
    expect(checkFrontmatter('docx', 'docx', source)).toEqual([]);
  });

  test('accepts a colon-space inside a quoted description', () => {
    const source = skillMd(
      "name: demo\ndescription: 'Use this: it works when quoted.'",
    );
    expect(checkFrontmatter('demo', 'demo', source)).toEqual([]);
  });

  test('fails on a `: ` colon-space in an unquoted description (strict YAML)', () => {
    const source = skillMd('name: demo\ndescription: uses: colons unquoted');
    const violations = checkFrontmatter('demo', 'demo', source);
    expect(violations).toHaveLength(1);
    expect(violations[0].skill).toBe('demo');
    expect(violations[0].problem).toContain('not valid YAML');
    // The offending value is on file line 3 (line 1 is the opening `---`).
    expect(violations[0].problem).toContain('line 3');
  });

  test('fails when the frontmatter block is missing', () => {
    const source = tree({ 'SKILL.md': '# Body without frontmatter\n' });
    const violations = checkFrontmatter('demo', 'demo', source);
    expect(violations).toHaveLength(1);
    expect(violations[0].problem).toContain('no YAML frontmatter block');
  });

  test('fails when `name` is missing', () => {
    const source = skillMd('description: Only a description here.');
    expect(checkFrontmatter('demo', 'demo', source)).toEqual([
      {
        skill: 'demo',
        problem:
          'SKILL.md frontmatter `name` is missing or not a non-empty string',
      },
    ]);
  });

  test('fails when `description` is missing', () => {
    const source = skillMd('name: demo');
    expect(checkFrontmatter('demo', 'demo', source)).toEqual([
      {
        skill: 'demo',
        problem:
          'SKILL.md frontmatter `description` is missing or not a non-empty string',
      },
    ]);
  });

  test('fails when `description` is empty', () => {
    const source = skillMd("name: demo\ndescription: ''");
    const violations = checkFrontmatter('demo', 'demo', source);
    expect(violations.map((v) => v.problem)).toContain(
      'SKILL.md frontmatter `description` is missing or not a non-empty string',
    );
  });

  test('fails when `description` is not a string', () => {
    const source = skillMd('name: demo\ndescription: 42');
    const violations = checkFrontmatter('demo', 'demo', source);
    expect(violations.map((v) => v.problem)).toContain(
      'SKILL.md frontmatter `description` is missing or not a non-empty string',
    );
  });

  test('fails when `name` does not match the skill directory', () => {
    const source = skillMd('name: other\ndescription: A description.');
    const violations = checkFrontmatter('demo', 'demo', source);
    expect(violations).toHaveLength(1);
    expect(violations[0].problem).toContain('must match the skill directory');
  });

  test('fails when the frontmatter is a scalar, not a mapping', () => {
    const source = skillMd('just a string');
    const violations = checkFrontmatter('demo', 'demo', source);
    expect(violations).toHaveLength(1);
    expect(violations[0].problem).toContain('must be a YAML mapping');
  });

  test('ignores a skill with no SKILL.md (reported elsewhere)', () => {
    expect(checkFrontmatter('demo', 'demo', tree({ 'other.md': 'x' }))).toEqual(
      [],
    );
  });
});
