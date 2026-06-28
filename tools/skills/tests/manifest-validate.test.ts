import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { SKILLS_MANIFEST, type SkillManifestEntry } from '../src/manifest';
import {
  RESERVED_CLAUDE_NAMES,
  validateManifest,
} from '../src/manifest-validate';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tale-skills-manifest-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Create skills/<name>/SKILL.md under the temp root so the existence check passes. */
function scaffold(name: string): void {
  const dir = join(root, 'skills', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: x\n---\n`,
  );
}

/** Loosely-typed entry so invalid shapes can be exercised. */
function entry(name: string, targets: string[]): SkillManifestEntry {
  return { name, targets } as unknown as SkillManifestEntry;
}

describe('validateManifest', () => {
  test('accepts a well-formed builtin-only skill', () => {
    scaffold('demo-skill');
    expect(() =>
      validateManifest([entry('demo-skill', ['builtin'])], root),
    ).not.toThrow();
  });

  test('rejects a non-kebab-case name', () => {
    scaffold('Bad_Name');
    expect(() =>
      validateManifest([entry('Bad_Name', ['builtin'])], root),
    ).toThrow(/kebab-case/);
  });

  test('rejects duplicate skill names', () => {
    scaffold('dup');
    expect(() =>
      validateManifest(
        [entry('dup', ['builtin']), entry('dup', ['claude'])],
        root,
      ),
    ).toThrow(/duplicate skill name/);
  });

  test('rejects an empty target list', () => {
    scaffold('demo-skill');
    expect(() => validateManifest([entry('demo-skill', [])], root)).toThrow(
      /no targets/,
    );
  });

  test('rejects an invalid target', () => {
    scaffold('demo-skill');
    expect(() =>
      validateManifest([entry('demo-skill', ['nope'])], root),
    ).toThrow(/invalid target/);
  });

  test('rejects duplicate targets', () => {
    scaffold('demo-skill');
    expect(() =>
      validateManifest([entry('demo-skill', ['builtin', 'builtin'])], root),
    ).toThrow(/twice/);
  });

  test('rejects a claude target that collides with a hand-authored guide', () => {
    const reserved = [...RESERVED_CLAUDE_NAMES][0];
    scaffold(reserved);
    expect(() => validateManifest([entry(reserved, ['claude'])], root)).toThrow(
      /collides with/,
    );
  });

  test('allows a reserved name when it does NOT target claude', () => {
    const reserved = [...RESERVED_CLAUDE_NAMES][0];
    scaffold(reserved);
    expect(() =>
      validateManifest([entry(reserved, ['builtin'])], root),
    ).not.toThrow();
  });

  test('rejects a manifest entry with no SKILL.md on disk', () => {
    expect(() =>
      validateManifest([entry('ghost-skill', ['builtin'])], root),
    ).toThrow(/no skills\/ghost-skill\/SKILL\.md/);
  });

  test('rejects a SKILL.md whose frontmatter name disagrees with the directory', () => {
    const dir = join(root, 'skills', 'demo-skill');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'SKILL.md'),
      '---\nname: not-demo-skill\ndescription: x\n---\n',
    );
    expect(() =>
      validateManifest([entry('demo-skill', ['builtin'])], root),
    ).toThrow(/exactly equal the directory name/);
  });
});

describe('the committed SKILLS_MANIFEST', () => {
  test('is valid against the real repo (tripwire)', () => {
    // This test lives at tools/skills/src/; the repo root is three levels up.
    const repoRoot = resolve(import.meta.dir, '../../..');
    expect(() => validateManifest(SKILLS_MANIFEST, repoRoot)).not.toThrow();
  });
});
