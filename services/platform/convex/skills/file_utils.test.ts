import { mkdtemp, rm, writeFile, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  resolveSkillAssetPath,
  resolveSkillAssetPathChecked,
  resolveSkillDir,
  resolveSkillMdPath,
  resolveSkillsDir,
  validateSkillSlug,
} from './file_utils';

let skillsRoot: string;
let prevSkillsDir: string | undefined;
let prevTaleConfigDir: string | undefined;

beforeEach(async () => {
  skillsRoot = await mkdtemp(path.join(tmpdir(), 'skills-test-'));
  prevSkillsDir = process.env.SKILLS_DIR;
  prevTaleConfigDir = process.env.TALE_CONFIG_DIR;
  process.env.SKILLS_DIR = skillsRoot;
  delete process.env.TALE_CONFIG_DIR;
});

afterEach(async () => {
  if (prevSkillsDir === undefined) {
    delete process.env.SKILLS_DIR;
  } else {
    process.env.SKILLS_DIR = prevSkillsDir;
  }
  if (prevTaleConfigDir !== undefined) {
    process.env.TALE_CONFIG_DIR = prevTaleConfigDir;
  }
  await rm(skillsRoot, { recursive: true, force: true });
});

describe('validateSkillSlug', () => {
  it('accepts hyphen-separated lowercase slugs', () => {
    expect(validateSkillSlug('code-reviewer')).toBe(true);
    expect(validateSkillSlug('pdf-extractor-v2')).toBe(true);
    expect(validateSkillSlug('a')).toBe(true);
  });

  it('rejects underscores', () => {
    expect(validateSkillSlug('code_reviewer')).toBe(false);
  });

  it('rejects leading/trailing/consecutive hyphens', () => {
    expect(validateSkillSlug('-leading')).toBe(false);
    expect(validateSkillSlug('trailing-')).toBe(false);
    expect(validateSkillSlug('double--hyphen')).toBe(false);
  });

  it('rejects uppercase letters and special chars', () => {
    expect(validateSkillSlug('CamelCase')).toBe(false);
    expect(validateSkillSlug('with space')).toBe(false);
    expect(validateSkillSlug('dot.case')).toBe(false);
    expect(validateSkillSlug('semi:colon')).toBe(false);
  });

  it('rejects empty and over-length slugs', () => {
    expect(validateSkillSlug('')).toBe(false);
    expect(validateSkillSlug('a'.repeat(65))).toBe(false);
  });
});

describe('resolveSkillsDir (org isolation)', () => {
  it('default org uses base dir directly', () => {
    expect(resolveSkillsDir('default')).toBe(skillsRoot);
  });

  it('other orgs live under @<orgSlug>/', () => {
    expect(resolveSkillsDir('acme-corp')).toBe(
      path.join(skillsRoot, '@acme-corp'),
    );
  });

  it('rejects invalid org slugs', () => {
    expect(() => resolveSkillsDir('../escape')).toThrow();
    expect(() => resolveSkillsDir('UPPER')).toThrow();
  });
});

describe('resolveSkillDir', () => {
  it('returns path under skills root', () => {
    const p = resolveSkillDir('default', 'code-reviewer');
    expect(p).toBe(path.join(skillsRoot, 'code-reviewer'));
  });

  it('rejects invalid slugs upstream', () => {
    expect(() => resolveSkillDir('default', 'bad_slug')).toThrow();
    expect(() => resolveSkillDir('default', '../escape')).toThrow();
  });
});

describe('resolveSkillMdPath', () => {
  it('appends SKILL.md', () => {
    expect(resolveSkillMdPath('default', 'code-reviewer')).toBe(
      path.join(skillsRoot, 'code-reviewer', 'SKILL.md'),
    );
  });
});

describe('resolveSkillAssetPath (traversal hardening)', () => {
  it('accepts a normal nested path', () => {
    const p = resolveSkillAssetPath(
      'default',
      'pdf-extractor',
      'scripts/extract.py',
    );
    expect(p).toBe(
      path.join(skillsRoot, 'pdf-extractor', 'scripts', 'extract.py'),
    );
  });

  it('rejects absolute paths', () => {
    expect(() =>
      resolveSkillAssetPath('default', 'x', '/etc/passwd'),
    ).toThrow();
  });

  it('rejects `..` segments', () => {
    expect(() => resolveSkillAssetPath('default', 'x', '../escape')).toThrow();
    expect(() =>
      resolveSkillAssetPath('default', 'x', 'scripts/../../escape'),
    ).toThrow();
  });

  it('rejects leading-dot segments (hidden files)', () => {
    expect(() => resolveSkillAssetPath('default', 'x', '.hidden')).toThrow();
    expect(() =>
      resolveSkillAssetPath('default', 'x', 'scripts/.secret'),
    ).toThrow();
  });

  it('rejects Windows drive prefix', () => {
    expect(() =>
      resolveSkillAssetPath('default', 'x', 'C:\\Windows'),
    ).toThrow();
  });

  it('rejects NUL bytes', () => {
    expect(() =>
      resolveSkillAssetPath('default', 'x', 'evil\0script.py'),
    ).toThrow();
  });

  it('rejects over-length paths', () => {
    expect(() =>
      resolveSkillAssetPath('default', 'x', 'a/'.repeat(120)),
    ).toThrow();
  });

  it('rejects SKILL.md (must be edited via markdown writer, not asset writer)', () => {
    expect(() => resolveSkillAssetPath('default', 'x', 'SKILL.md')).toThrow();
  });
});

describe('resolveSkillAssetPathChecked (realpath / symlink defense)', () => {
  it('catches a symlink planted as an intermediate directory', async () => {
    // skills/<slug>/escape → ../../outside
    const slug = 'symlink-test';
    const skillDir = path.join(skillsRoot, slug);
    await mkdir(skillDir, { recursive: true });
    const outside = path.join(skillsRoot, '..', 'outside');
    await mkdir(outside, { recursive: true });
    await symlink(outside, path.join(skillDir, 'escape'));

    await expect(
      resolveSkillAssetPathChecked('default', slug, 'escape/leak.txt'),
    ).rejects.toThrow();

    await rm(outside, { recursive: true, force: true });
  });

  it('allows asset reads through a real subdirectory', async () => {
    const slug = 'normal-test';
    const dir = path.join(skillsRoot, slug, 'scripts');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'run.py'), 'print("ok")');

    const resolved = await resolveSkillAssetPathChecked(
      'default',
      slug,
      'scripts/run.py',
    );
    expect(resolved).toBe(path.join(skillsRoot, slug, 'scripts', 'run.py'));
  });
});
