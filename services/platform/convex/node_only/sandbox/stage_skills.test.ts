import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { collectStageSkillFiles, validateStageInclude } from './stage_skills';

describe('validateStageInclude', () => {
  it('accepts plain relative subpaths', () => {
    expect(validateStageInclude('engine')).toBeNull();
    expect(validateStageInclude('mapping/rates.yaml')).toBeNull();
    expect(validateStageInclude('schema/eCH-0217.xsd')).toBeNull();
  });

  it('rejects traversal, absolute, drive, leading-dot, NUL, empty, oversized', () => {
    expect(validateStageInclude('..')).not.toBeNull();
    expect(validateStageInclude('engine/../../etc')).not.toBeNull();
    expect(validateStageInclude('/etc/passwd')).not.toBeNull();
    expect(validateStageInclude('C:/win')).not.toBeNull();
    expect(validateStageInclude('.git')).not.toBeNull();
    expect(validateStageInclude('engine/.secret')).not.toBeNull();
    expect(validateStageInclude('a\0b')).not.toBeNull();
    expect(validateStageInclude('')).not.toBeNull();
    expect(validateStageInclude('x'.repeat(201))).not.toBeNull();
  });
});

describe('collectStageSkillFiles', () => {
  const ORG = 'testorg';
  const SLUG = 'demo-skill';
  const prevConfigDir = process.env.TALE_CONFIG_DIR;
  let root: string;
  let skillDir: string;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'stage-skills-'));
    process.env.TALE_CONFIG_DIR = root;
    skillDir = path.join(root, ORG, 'skills', SLUG);
    await mkdir(path.join(skillDir, 'engine', 'sub'), { recursive: true });
    await mkdir(path.join(skillDir, 'engine', '__pycache__'), {
      recursive: true,
    });
    await mkdir(path.join(skillDir, 'mapping'), { recursive: true });
    await mkdir(path.join(skillDir, 'tests'), { recursive: true });
    await writeFile(path.join(skillDir, 'engine', 'a.py'), 'print("a")\n');
    await writeFile(path.join(skillDir, 'engine', 'sub', 'b.py'), 'B = 1\n');
    await writeFile(path.join(skillDir, 'engine', 'cached.pyc'), 'junk');
    await writeFile(path.join(skillDir, 'engine', '__pycache__', 'z.pyc'), 'x');
    await writeFile(path.join(skillDir, 'engine', '.secret'), 'nope');
    await writeFile(path.join(skillDir, 'mapping', 't.yaml'), 'k: v\n');
    await writeFile(path.join(skillDir, 'tests', 'big.py'), 'x = 0\n');
  });

  afterAll(async () => {
    if (prevConfigDir === undefined) delete process.env.TALE_CONFIG_DIR;
    else process.env.TALE_CONFIG_DIR = prevConfigDir;
    await rm(root, { recursive: true, force: true });
  });

  it('stages only the included subtrees, skipping junk and excluded dirs', async () => {
    const files = await collectStageSkillFiles(ORG, [
      { slug: SLUG, include: ['engine', 'mapping'] },
    ]);
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual([
      `code/skills/${SLUG}/engine/a.py`,
      `code/skills/${SLUG}/engine/sub/b.py`,
      `code/skills/${SLUG}/mapping/t.yaml`,
    ]);
    // Every staged file carries inline bytes that round-trip to the source.
    const a = files.find((f) => f.path.endsWith('engine/a.py'));
    expect(a?.contentBase64).toBeDefined();
    expect(Buffer.from(a?.contentBase64 ?? '', 'base64').toString('utf8')).toBe(
      'print("a")\n',
    );
    // tests/ was never requested; __pycache__, *.pyc and dotfiles are skipped.
    expect(paths.some((p) => p.includes('/tests/'))).toBe(false);
    expect(paths.some((p) => p.includes('__pycache__'))).toBe(false);
    expect(paths.some((p) => p.endsWith('.pyc'))).toBe(false);
    expect(paths.some((p) => p.endsWith('.secret'))).toBe(false);
  });

  it('stages a single included file', async () => {
    const files = await collectStageSkillFiles(ORG, [
      { slug: SLUG, include: ['mapping/t.yaml'] },
    ]);
    expect(files.map((f) => f.path)).toEqual([
      `code/skills/${SLUG}/mapping/t.yaml`,
    ]);
  });

  it('fails loud when the file cap is exceeded', async () => {
    await expect(
      collectStageSkillFiles(ORG, [{ slug: SLUG, include: ['engine'] }], {
        maxFiles: 1,
        maxBytes: 8 << 20,
      }),
    ).rejects.toThrow(/file cap/i);
  });

  it('fails loud when the byte cap is exceeded', async () => {
    await expect(
      collectStageSkillFiles(ORG, [{ slug: SLUG, include: ['engine'] }], {
        maxFiles: 100,
        maxBytes: 1,
      }),
    ).rejects.toThrow(/byte cap/i);
  });

  it('rejects an invalid slug', async () => {
    await expect(
      collectStageSkillFiles(ORG, [{ slug: '../evil', include: ['engine'] }]),
    ).rejects.toThrow(/invalid skill slug/i);
  });

  it('rejects a traversal include', async () => {
    await expect(
      collectStageSkillFiles(ORG, [{ slug: SLUG, include: ['../../etc'] }]),
    ).rejects.toThrow(/include/i);
  });

  it('rejects a missing include', async () => {
    await expect(
      collectStageSkillFiles(ORG, [{ slug: SLUG, include: ['nope'] }]),
    ).rejects.toThrow(/not found/i);
  });
});
