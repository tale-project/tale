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

// Under the uniform org-first layout, every org's skills live at
// `${TALE_CONFIG_DIR}/<orgSlug>/skills/` — including the default org
// (which is no longer special-cased). All resolvers compose on top of
// `${TALE_CONFIG_DIR}`; the per-domain SKILLS_DIR override has been dropped.
let configRoot: string;
let prevTaleConfigDir: string | undefined;
let prevSkillsDir: string | undefined;

beforeEach(async () => {
  configRoot = await mkdtemp(path.join(tmpdir(), 'skills-test-'));
  prevTaleConfigDir = process.env.TALE_CONFIG_DIR;
  prevSkillsDir = process.env.SKILLS_DIR;
  process.env.TALE_CONFIG_DIR = configRoot;
  // Explicitly clear the legacy per-domain override so its presence in the
  // shell env can't accidentally satisfy any leftover fallback.
  delete process.env.SKILLS_DIR;
});

afterEach(async () => {
  if (prevTaleConfigDir === undefined) {
    delete process.env.TALE_CONFIG_DIR;
  } else {
    process.env.TALE_CONFIG_DIR = prevTaleConfigDir;
  }
  if (prevSkillsDir !== undefined) {
    process.env.SKILLS_DIR = prevSkillsDir;
  }
  await rm(configRoot, { recursive: true, force: true });
});

// Helper: where this test's "default org skills dir" lives under org-first.
function defaultSkillsDir(): string {
  return path.join(configRoot, 'default', 'skills');
}

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

describe('resolveSkillsDir (org isolation, org-first)', () => {
  it('default org lives at <root>/default/skills/', () => {
    expect(resolveSkillsDir('default')).toBe(defaultSkillsDir());
  });

  it('other orgs live at <root>/<orgSlug>/skills/ (no @-prefix)', () => {
    expect(resolveSkillsDir('acme-corp')).toBe(
      path.join(configRoot, 'acme-corp', 'skills'),
    );
  });

  it('rejects invalid org slugs', () => {
    expect(() => resolveSkillsDir('../escape')).toThrow();
    expect(() => resolveSkillsDir('UPPER')).toThrow();
  });
});

describe('resolveSkillDir', () => {
  it('returns path under <org>/skills/<slug>', () => {
    const p = resolveSkillDir('default', 'code-reviewer');
    expect(p).toBe(path.join(defaultSkillsDir(), 'code-reviewer'));
  });

  it('rejects invalid slugs upstream', () => {
    expect(() => resolveSkillDir('default', 'bad_slug')).toThrow();
    expect(() => resolveSkillDir('default', '../escape')).toThrow();
  });
});

describe('resolveSkillMdPath', () => {
  it('appends SKILL.md', () => {
    expect(resolveSkillMdPath('default', 'code-reviewer')).toBe(
      path.join(defaultSkillsDir(), 'code-reviewer', 'SKILL.md'),
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
      path.join(defaultSkillsDir(), 'pdf-extractor', 'scripts', 'extract.py'),
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
    // <root>/default/skills/<slug>/escape → ../../../outside
    const slug = 'symlink-test';
    const skillDir = path.join(defaultSkillsDir(), slug);
    await mkdir(skillDir, { recursive: true });
    const outside = path.join(configRoot, 'outside');
    await mkdir(outside, { recursive: true });
    await symlink(outside, path.join(skillDir, 'escape'));

    await expect(
      resolveSkillAssetPathChecked('default', slug, 'escape/leak.txt'),
    ).rejects.toThrow();

    await rm(outside, { recursive: true, force: true });
  });

  it('allows asset reads through a real subdirectory', async () => {
    const slug = 'normal-test';
    const dir = path.join(defaultSkillsDir(), slug, 'scripts');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'run.py'), 'print("ok")');

    const resolved = await resolveSkillAssetPathChecked(
      'default',
      slug,
      'scripts/run.py',
    );
    expect(resolved).toBe(
      path.join(defaultSkillsDir(), slug, 'scripts', 'run.py'),
    );
  });
});
