import { describe, expect, it } from 'vitest';

import {
  listOrgSkills,
  readOrgSkill,
  readOrgSkills,
  type SkillBundleReader,
} from './listing';
import { SkillParseError } from './parse';
import type { SkillViewer } from './visibility';

function user(
  userId: string,
  opts: { teamIds?: string[]; isOrgAdmin?: boolean } = {},
): SkillViewer {
  return {
    kind: 'user',
    userId,
    teamIds: opts.teamIds ?? [],
    isOrgAdmin: opts.isOrgAdmin ?? false,
  };
}

const alice = user('user_alice', { teamIds: ['team_red'] });
const bob = user('user_bob');

function skillMd(fields: Record<string, string>, body = 'Body.\n'): string {
  const frontmatter = Object.entries(fields)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
  return `---\n${frontmatter}\n---\n\n${body}`;
}

/**
 * An in-memory reader for ONE organization. Its whole point is that it cannot
 * be pointed at a second org — the same property the filesystem reader has.
 */
function fakeReader(
  orgSlug: string,
  files: Record<string, string>,
): SkillBundleReader {
  return {
    listSlugs: () => Promise.resolve(Object.keys(files)),
    readSkillMd: (slug) => Promise.resolve(files[slug] ?? null),
    describe: (slug) => `${orgSlug}/skills/${slug}/SKILL.md`,
  };
}

const acme = fakeReader('acme', {
  'write-notes': skillMd({
    name: 'write-notes',
    description: 'Acme note discipline.',
    visibility: 'org',
  }),
  'alice-drafts': skillMd({
    name: 'alice-drafts',
    description: 'Alice’s scratch prompts.',
    visibility: 'private',
    owner: 'user_alice',
  }),
  'bob-drafts': skillMd({
    name: 'bob-drafts',
    description: 'Bob’s scratch prompts.',
    visibility: 'private',
    owner: 'user_bob',
  }),
  'red-notes': skillMd({
    name: 'red-notes',
    description: 'The red team’s shared notes.',
    visibility: 'team',
    teams: '[team_red]',
    owner: 'user_carol',
  }),
  // Carries the retired `usage-mode` key: a legacy bundle must keep listing
  // as an ordinary org skill, the stale key ignored.
  'chat-helper': skillMd({
    name: 'chat-helper',
    description: 'A legacy bundle still carrying a usage-mode key.',
    visibility: 'org',
    'usage-mode': 'chat',
  }),
});

const globex = fakeReader('globex', {
  'globex-tone': skillMd({
    name: 'globex-tone',
    description: 'Globex house voice.',
    visibility: 'org',
  }),
  'alice-drafts': skillMd({
    name: 'alice-drafts',
    description: 'A Globex member’s private drafts.',
    visibility: 'private',
    owner: 'user_alice',
  }),
});

describe('readOrgSkill', () => {
  it('reads one bundle', async () => {
    const skill = await readOrgSkill(acme, 'write-notes');

    expect(skill?.slug).toBe('write-notes');
    expect(skill?.meta.description).toBe('Acme note discipline.');
    expect(skill?.path).toBe('acme/skills/write-notes/SKILL.md');
  });

  it('returns null for a bundle the org does not have', async () => {
    expect(await readOrgSkill(acme, 'globex-tone')).toBeNull();
  });

  it('refuses a frontmatter name that contradicts the directory', async () => {
    const reader = fakeReader('acme', {
      'write-notes': skillMd({
        name: 'other-name',
        description: 'Mismatched.',
      }),
    });

    await expect(readOrgSkill(reader, 'write-notes')).rejects.toThrow(
      /does not match the bundle directory/,
    );
  });

  it('rejects a slug that could never be a directory name', async () => {
    await expect(readOrgSkill(acme, '../escape')).rejects.toBeInstanceOf(
      SkillParseError,
    );
  });
});

describe('readOrgSkills', () => {
  it('sorts by slug and keeps a malformed bundle out, with its path', async () => {
    const reader = fakeReader('acme', {
      zulu: skillMd({ name: 'zulu', description: 'Last alphabetically.' }),
      broken: '# no frontmatter at all\n',
      alpha: skillMd({ name: 'alpha', description: 'First alphabetically.' }),
    });

    const { skills, failures } = await readOrgSkills(reader);

    expect(skills.map((skill) => skill.slug)).toEqual(['alpha', 'zulu']);
    expect(failures).toHaveLength(1);
    expect(failures[0].slug).toBe('broken');
    expect(failures[0].path).toBe('acme/skills/broken/SKILL.md');
    expect(failures[0].message).toContain('acme/skills/broken/SKILL.md');
  });

  it('does not apply visibility', async () => {
    const { skills } = await readOrgSkills(acme);

    expect(skills.map((skill) => skill.slug)).toEqual([
      'alice-drafts',
      'bob-drafts',
      'chat-helper',
      'red-notes',
      'write-notes',
    ]);
  });
});

describe('listOrgSkills', () => {
  it('gives each member the org skills plus only their own private ones', async () => {
    const forAlice = await listOrgSkills(acme, alice);
    const forBob = await listOrgSkills(acme, bob);

    expect(forAlice.skills.map((skill) => skill.slug)).toEqual([
      'alice-drafts',
      'chat-helper',
      'red-notes',
      'write-notes',
    ]);
    expect(forBob.skills.map((skill) => skill.slug)).toEqual([
      'bob-drafts',
      'chat-helper',
      'write-notes',
    ]);
  });

  it('resolves team skills for a project viewer by team overlap', async () => {
    const redProject = await listOrgSkills(acme, {
      kind: 'project',
      teamIds: ['team_red'],
    });
    const orgWideProject = await listOrgSkills(acme, {
      kind: 'project',
      teamIds: [],
    });

    expect(redProject.skills.map((skill) => skill.slug)).toEqual([
      'chat-helper',
      'red-notes',
      'write-notes',
    ]);
    expect(orgWideProject.skills.map((skill) => skill.slug)).toEqual([
      'chat-helper',
      'write-notes',
    ]);
  });

  it('keeps one organization’s library out of another, in both directions', async () => {
    const acmeForAlice = await listOrgSkills(acme, alice);
    const globexForAlice = await listOrgSkills(globex, alice);

    expect(acmeForAlice.skills.map((skill) => skill.slug)).not.toContain(
      'globex-tone',
    );
    expect(globexForAlice.skills.map((skill) => skill.slug)).not.toContain(
      'write-notes',
    );

    // The same slug in two orgs resolves to two different bundles — reading
    // one never reaches the other's file.
    const fromAcme = acmeForAlice.skills.find(
      (skill) => skill.slug === 'alice-drafts',
    );
    const fromGlobex = globexForAlice.skills.find(
      (skill) => skill.slug === 'alice-drafts',
    );
    expect(fromAcme?.meta.description).toBe('Alice’s scratch prompts.');
    expect(fromGlobex?.meta.description).toBe(
      'A Globex member’s private drafts.',
    );
    expect(fromAcme?.path).toBe('acme/skills/alice-drafts/SKILL.md');
    expect(fromGlobex?.path).toBe('globex/skills/alice-drafts/SKILL.md');
  });

  it('reports failures to everyone, whoever the bundle belonged to', async () => {
    const reader = fakeReader('acme', { broken: '---\nname: broken\n' });

    expect((await listOrgSkills(reader, alice)).failures).toHaveLength(1);
    expect((await listOrgSkills(reader, bob)).failures).toHaveLength(1);
  });
});
