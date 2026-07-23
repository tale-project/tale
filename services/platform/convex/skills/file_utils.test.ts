// @vitest-environment node

import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readOrgSkill, readOrgSkills } from '../../lib/skills/listing';
import {
  createOrgSkillReader,
  listSkillSlugs,
  readSkillMdText,
  removeSkillBundle,
  resolveSkillDir,
  resolveSkillHistoryDir,
  resolveSkillMdPath,
  resolveSkillsDir,
  writeSkillMdText,
} from './file_utils';

let configRoot: string;
let savedConfigDir: string | undefined;

beforeEach(async () => {
  savedConfigDir = process.env.TALE_CONFIG_DIR;
  configRoot = await mkdtemp(path.join(tmpdir(), 'tale-skills-'));
  process.env.TALE_CONFIG_DIR = configRoot;
});

afterEach(async () => {
  if (savedConfigDir === undefined) {
    delete process.env.TALE_CONFIG_DIR;
  } else {
    process.env.TALE_CONFIG_DIR = savedConfigDir;
  }
  await rm(configRoot, { recursive: true, force: true });
});

function skillMd(fields: Record<string, string>, body = 'Body.\n'): string {
  const frontmatter = Object.entries(fields)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
  return `---\n${frontmatter}\n---\n\n${body}`;
}

async function seedSkill(
  orgSlug: string,
  slug: string,
  content: string,
): Promise<void> {
  const dir = path.join(configRoot, orgSlug, 'skills', slug);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'SKILL.md'), content, 'utf-8');
}

describe('path resolution', () => {
  it('puts every org’s skills under its own config subtree', () => {
    expect(resolveSkillsDir('acme')).toBe(
      path.join(configRoot, 'acme', 'skills'),
    );
    expect(resolveSkillDir('acme', 'write-notes')).toBe(
      path.join(configRoot, 'acme', 'skills', 'write-notes'),
    );
    expect(resolveSkillMdPath('acme', 'write-notes')).toBe(
      path.join(configRoot, 'acme', 'skills', 'write-notes', 'SKILL.md'),
    );
    expect(resolveSkillHistoryDir('acme', 'write-notes')).toBe(
      path.join(configRoot, 'acme', 'skills', '.history', 'write-notes'),
    );
  });

  it('refuses an org slug or skill slug that could escape the tree', () => {
    expect(() => resolveSkillsDir('../etc')).toThrow(/Invalid org slug/);
    expect(() => resolveSkillDir('acme', '../../etc')).toThrow(
      /Invalid skill slug/,
    );
    expect(() => resolveSkillDir('acme', 'Write-Notes')).toThrow(
      /Invalid skill slug/,
    );
  });
});

describe('listSkillSlugs', () => {
  it('reads an org with no skills directory as an empty library', async () => {
    expect(await listSkillSlugs('acme')).toEqual([]);
  });

  it('lists bundle directories and ignores everything else', async () => {
    await seedSkill(
      'acme',
      'write-notes',
      skillMd({ name: 'write-notes', description: 'x' }),
    );
    await mkdir(
      path.join(configRoot, 'acme', 'skills', '.history', 'write-notes'),
      {
        recursive: true,
      },
    );
    await writeFile(
      path.join(configRoot, 'acme', 'skills', 'README.md'),
      'not a bundle\n',
      'utf-8',
    );
    await mkdir(path.join(configRoot, 'acme', 'skills', 'Not A Slug'), {
      recursive: true,
    });

    expect(await listSkillSlugs('acme')).toEqual(['write-notes']);
  });
});

describe('readSkillMdText', () => {
  it('returns null for a bundle with no SKILL.md', async () => {
    await mkdir(path.join(configRoot, 'acme', 'skills', 'empty'), {
      recursive: true,
    });

    expect(await readSkillMdText('acme', 'empty')).toBeNull();
  });

  it('refuses a symlinked SKILL.md instead of following it', async () => {
    const secret = path.join(configRoot, 'secret.md');
    await writeFile(secret, 'secret\n', 'utf-8');
    await mkdir(path.join(configRoot, 'acme', 'skills', 'sneaky'), {
      recursive: true,
    });
    await symlink(
      secret,
      path.join(configRoot, 'acme', 'skills', 'sneaky', 'SKILL.md'),
    );

    await expect(readSkillMdText('acme', 'sneaky')).rejects.toThrow(/Symlink/);
  });

  it('refuses a bundle directory that symlinks out of the tree', async () => {
    const outside = path.join(configRoot, 'outside');
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, 'SKILL.md'), 'x\n', 'utf-8');
    await mkdir(path.join(configRoot, 'acme', 'skills'), { recursive: true });
    await symlink(outside, path.join(configRoot, 'acme', 'skills', 'escape'));

    await expect(readSkillMdText('acme', 'escape')).rejects.toThrow(
      /bundle directory is a symlink/,
    );
  });
});

describe('per-organization isolation', () => {
  it('keeps two orgs’ same-named skills apart, in both directions', async () => {
    await seedSkill(
      'acme',
      'house-voice',
      skillMd({ name: 'house-voice', description: 'Acme voice.' }),
    );
    await seedSkill(
      'globex',
      'house-voice',
      skillMd({ name: 'house-voice', description: 'Globex voice.' }),
    );
    await seedSkill(
      'acme',
      'acme-only',
      skillMd({ name: 'acme-only', description: 'Acme only.' }),
    );

    const acme = await readOrgSkills(createOrgSkillReader('acme'));
    const globex = await readOrgSkills(createOrgSkillReader('globex'));

    expect(acme.skills.map((skill) => skill.slug)).toEqual([
      'acme-only',
      'house-voice',
    ]);
    expect(globex.skills.map((skill) => skill.slug)).toEqual(['house-voice']);

    expect(
      acme.skills.find((skill) => skill.slug === 'house-voice')?.meta
        .description,
    ).toBe('Acme voice.');
    expect(
      globex.skills.find((skill) => skill.slug === 'house-voice')?.meta
        .description,
    ).toBe('Globex voice.');

    // Neither org can reach the other's exclusive bundle.
    expect(
      await readOrgSkill(createOrgSkillReader('globex'), 'acme-only'),
    ).toBeNull();
    await seedSkill(
      'globex',
      'globex-only',
      skillMd({ name: 'globex-only', description: 'Globex only.' }),
    );
    expect(
      await readOrgSkill(createOrgSkillReader('acme'), 'globex-only'),
    ).toBeNull();
  });

  it('reports a malformed bundle with its own org’s path', async () => {
    await seedSkill('acme', 'broken', '# no frontmatter\n');

    const { skills, failures } = await readOrgSkills(
      createOrgSkillReader('acme'),
    );

    expect(skills).toEqual([]);
    expect(failures).toHaveLength(1);
    expect(failures[0].path).toBe(resolveSkillMdPath('acme', 'broken'));
    expect(failures[0].message).toContain(
      path.join('acme', 'skills', 'broken'),
    );
  });
});

describe('writeSkillMdText', () => {
  it('creates the bundle on first write and leaves no history behind', async () => {
    const content = skillMd({ name: 'write-notes', description: 'First.' });
    await writeSkillMdText('acme', 'write-notes', content);

    expect(
      await readFile(resolveSkillMdPath('acme', 'write-notes'), 'utf-8'),
    ).toBe(content);
    await expect(
      readdir(resolveSkillHistoryDir('acme', 'write-notes')),
    ).rejects.toThrow();
  });

  it('keeps the superseded version in the domain’s history trail', async () => {
    await writeSkillMdText(
      'acme',
      'write-notes',
      skillMd({ name: 'write-notes', description: 'First.' }),
    );
    await writeSkillMdText(
      'acme',
      'write-notes',
      skillMd({ name: 'write-notes', description: 'Second.' }),
    );

    const trail = await readdir(resolveSkillHistoryDir('acme', 'write-notes'));
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatch(/\.md$/);
    expect(
      await readFile(
        path.join(resolveSkillHistoryDir('acme', 'write-notes'), trail[0]),
        'utf-8',
      ),
    ).toContain('First.');
    expect(await readSkillMdText('acme', 'write-notes')).toContain('Second.');
  });

  it('keeps the history trail out of the listed bundles', async () => {
    await writeSkillMdText(
      'acme',
      'write-notes',
      skillMd({ name: 'write-notes', description: 'First.' }),
    );
    await writeSkillMdText(
      'acme',
      'write-notes',
      skillMd({ name: 'write-notes', description: 'Second.' }),
    );

    expect(await listSkillSlugs('acme')).toEqual(['write-notes']);
  });
});

describe('removeSkillBundle', () => {
  it('removes the bundle and its trail, and is a no-op the second time', async () => {
    await writeSkillMdText(
      'acme',
      'write-notes',
      skillMd({ name: 'write-notes', description: 'First.' }),
    );
    await writeSkillMdText(
      'acme',
      'write-notes',
      skillMd({ name: 'write-notes', description: 'Second.' }),
    );

    expect(await removeSkillBundle('acme', 'write-notes')).toBe(true);
    expect(await listSkillSlugs('acme')).toEqual([]);
    await expect(
      readdir(resolveSkillHistoryDir('acme', 'write-notes')),
    ).rejects.toThrow();
    expect(await removeSkillBundle('acme', 'write-notes')).toBe(false);
  });

  it('never reaches another organization’s bundle of the same name', async () => {
    await seedSkill(
      'acme',
      'house-voice',
      skillMd({ name: 'house-voice', description: 'Acme voice.' }),
    );
    await seedSkill(
      'globex',
      'house-voice',
      skillMd({ name: 'house-voice', description: 'Globex voice.' }),
    );

    await removeSkillBundle('acme', 'house-voice');

    expect(await listSkillSlugs('acme')).toEqual([]);
    expect(await listSkillSlugs('globex')).toEqual(['house-voice']);
  });
});
