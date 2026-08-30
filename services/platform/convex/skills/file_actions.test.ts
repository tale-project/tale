// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppError } from '../../lib/shared/errors/app-error';

// The `*ForViewer` functions ARE the skill-file surface now — the Convex
// action wrappers that used to delegate to them retired with the runtime —
// so each is driven directly against a real temporary config tree.
//
// The bundle-UPLOAD lane is not here: its 0.4 wrapper carried the ownership
// gate and blob plumbing itself, and that orchestration was rebuilt natively
// as `backend/domains/skills/upload.ts`. It is covered end-to-end (install /
// confirm / force / foreign-org / garbage) by the integration run against a
// real database and a real staged zip.
// oxlint-disable-next-line typescript/no-explicit-any -- each returns its own view type; the tests assert on the values
type ViewerFn = (args: unknown) => Promise<any>;

let configRoot: string;
let savedConfigDir: string | undefined;

beforeEach(async () => {
  savedConfigDir = process.env.TALE_CONFIG_DIR;
  configRoot = await mkdtemp(path.join(tmpdir(), 'tale-skill-actions-'));
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

async function load(name: string): Promise<ViewerFn> {
  const mod = (await import('./file_actions')) as unknown as Record<
    string,
    ViewerFn
  >;
  return mod[name];
}

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

function userViewer(
  userId: string,
  opts: { teamIds?: string[]; isOrgAdmin?: boolean } = {},
) {
  return {
    viewer: {
      kind: 'user' as const,
      userId,
      teamIds: opts.teamIds ?? [],
      isOrgAdmin: opts.isOrgAdmin ?? false,
    },
  };
}

const alice = userViewer('user_alice', { teamIds: ['team_red'] });
const bob = userViewer('user_bob');
const admin = userViewer('user_admin', { isOrgAdmin: true });

function errorCode(err: unknown): string | undefined {
  if (err instanceof AppError) {
    const data: unknown = err.data;
    if (typeof data === 'object' && data !== null && 'code' in data) {
      return String(data.code);
    }
  }
  return undefined;
}

describe('listSkills', () => {
  it('shows a private skill only to its owner', async () => {
    await seedSkill(
      'acme',
      'alice-drafts',
      skillMd({
        name: 'alice-drafts',
        description: 'Personal.',
        visibility: 'private',
        owner: 'user_alice',
      }),
    );
    await seedSkill(
      'acme',
      'house-voice',
      skillMd({
        name: 'house-voice',
        description: 'Shared.',
        visibility: 'org',
      }),
    );
    const listSkills = await load('listSkillsForViewer');

    const forAlice = await listSkills({
      orgSlug: 'acme',
      ...alice,
    });
    const forBob = await listSkills({ orgSlug: 'acme', ...bob });
    const forAdmin = await listSkills({
      orgSlug: 'acme',
      ...admin,
    });

    expect(forAlice.skills.map((s: { slug: string }) => s.slug)).toEqual([
      'alice-drafts',
      'house-voice',
    ]);
    expect(forBob.skills.map((s: { slug: string }) => s.slug)).toEqual([
      'house-voice',
    ]);
    expect(forAdmin.skills.map((s: { slug: string }) => s.slug)).toEqual([
      'house-voice',
    ]);
  });

  it('marks who may edit what', async () => {
    await seedSkill(
      'acme',
      'house-voice',
      skillMd({
        name: 'house-voice',
        description: 'Shared.',
        visibility: 'org',
        owner: 'user_alice',
      }),
    );
    const listSkills = await load('listSkillsForViewer');

    const asBob = await listSkills({ orgSlug: 'acme', ...bob });
    const asAdmin = await listSkills({
      orgSlug: 'acme',
      ...admin,
    });
    const asAlice = await listSkills({
      orgSlug: 'acme',
      ...alice,
    });

    expect(asBob.skills[0].canEdit).toBe(false);
    expect(asAdmin.skills[0].canEdit).toBe(true);
    expect(asAlice.skills[0].canEdit).toBe(true);
  });

  it('reports a malformed bundle with its org-relative path', async () => {
    await seedSkill('acme', 'broken', '# no frontmatter\n');
    const listSkills = await load('listSkillsForViewer');

    const listing = await listSkills({
      orgSlug: 'acme',
      ...alice,
    });

    expect(listing.skills).toEqual([]);
    expect(listing.failures).toEqual([
      {
        slug: 'broken',
        path: 'skills/broken/SKILL.md',
        message: expect.stringContaining('broken'),
      },
    ]);
    // The absolute server path never crosses the wire.
    expect(listing.failures[0].path).not.toContain(configRoot);
  });

  it('lists each organization separately, in both directions', async () => {
    await seedSkill(
      'acme',
      'house-voice',
      skillMd({ name: 'house-voice', description: 'Acme.' }),
    );
    await seedSkill(
      'globex',
      'house-voice',
      skillMd({ name: 'house-voice', description: 'Globex.' }),
    );
    await seedSkill(
      'globex',
      'globex-only',
      skillMd({ name: 'globex-only', description: 'Globex only.' }),
    );
    const listSkills = await load('listSkillsForViewer');

    const acme = await listSkills({ orgSlug: 'acme', ...alice });
    const globex = await listSkills({
      orgSlug: 'globex',
      ...alice,
    });

    expect(acme.skills.map((s: { slug: string }) => s.slug)).toEqual([
      'house-voice',
    ]);
    expect(acme.skills[0].description).toBe('Acme.');
    expect(globex.skills.map((s: { slug: string }) => s.slug)).toEqual([
      'globex-only',
      'house-voice',
    ]);
    expect(
      globex.skills.find((s: { slug: string }) => s.slug === 'house-voice')
        .description,
    ).toBe('Globex.');
  });
});

describe('readSkill', () => {
  it('reads a member’s own private skill and hides someone else’s', async () => {
    await seedSkill(
      'acme',
      'alice-drafts',
      skillMd(
        {
          name: 'alice-drafts',
          description: 'Personal.',
          visibility: 'private',
          owner: 'user_alice',
        },
        'Secret notes.\n',
      ),
    );
    const readSkill = await load('readSkillForViewer');

    const mine = await readSkill({
      orgSlug: 'acme',
      slug: 'alice-drafts',
      ...alice,
    });
    expect(mine.body).toBe('Secret notes.\n');

    // Absent, not forbidden: acknowledging it would already leak its existence.
    expect(
      await readSkill({
        orgSlug: 'acme',
        slug: 'alice-drafts',
        ...bob,
      }),
    ).toBeNull();
    expect(
      await readSkill({
        orgSlug: 'acme',
        slug: 'alice-drafts',
        ...admin,
      }),
    ).toBeNull();
  });

  it('reports a malformed bundle instead of pretending it is absent', async () => {
    await seedSkill('acme', 'broken', '---\nname: broken\n');
    const readSkill = await load('readSkillForViewer');

    try {
      await readSkill({
        orgSlug: 'acme',
        slug: 'broken',
        ...alice,
      });
      expect.unreachable('a malformed bundle must not read as absent');
    } catch (err) {
      expect(errorCode(err)).toBe('SKILL_MALFORMED');
      expect((err as AppError<{ message: string }>).data.message).toContain(
        'skills/broken/SKILL.md',
      );
    }
  });

  it('rejects a slug that is not a bundle name', async () => {
    const readSkill = await load('readSkillForViewer');

    await expect(
      readSkill({
        orgSlug: 'acme',
        slug: '../../etc',
        ...alice,
      }),
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe('saveSkill', () => {
  it('creates an org skill owned by its author', async () => {
    const saveSkill = await load('saveSkillForViewer');

    const saved = await saveSkill({
      orgSlug: 'acme',
      slug: 'house-voice',
      ...alice,
      description: 'Shared by default.',
      body: 'Notes.\n',
    });

    expect(saved.visibility).toBe('org');
    expect(saved.owner).toBe('user_alice');
    expect(saved.canEdit).toBe(true);

    const listSkills = await load('listSkillsForViewer');
    const forBob = await listSkills({ orgSlug: 'acme', ...bob });
    expect(forBob.skills.map((s: { slug: string }) => s.slug)).toEqual([
      'house-voice',
    ]);
  });

  it('refuses to mint a private skill', async () => {
    const saveSkill = await load('saveSkillForViewer');

    try {
      await saveSkill({
        orgSlug: 'acme',
        slug: 'alice-drafts',
        ...alice,
        description: 'Personal.',
        body: 'Notes.\n',
        visibility: 'private',
      });
      expect.unreachable('a new private skill must be refused');
    } catch (err) {
      expect(errorCode(err)).toBe('SKILL_PRIVATE_RETIRED');
    }
  });

  it('keeps a pre-existing private skill private, and shares it with one flip', async () => {
    // A legacy bundle from before the retirement: still its owner's alone.
    await seedSkill(
      'acme',
      'alice-drafts',
      skillMd({
        name: 'alice-drafts',
        description: 'Personal.',
        visibility: 'private',
        owner: 'user_alice',
      }),
    );
    const saveSkill = await load('saveSkillForViewer');
    const listSkills = await load('listSkillsForViewer');

    // An edit that does not touch visibility keeps it private — the owner is
    // not forced to reshare just to fix a typo. Sending `private` explicitly
    // (the edit form echoes the current state) is equally allowed.
    const edited = await saveSkill({
      orgSlug: 'acme',
      slug: 'alice-drafts',
      ...alice,
      description: 'Personal, retitled.',
      body: 'Notes.\n',
      visibility: 'private',
    });
    expect(edited.visibility).toBe('private');
    expect((await listSkills({ orgSlug: 'acme', ...bob })).skills).toEqual([]);

    // Sharing is one edit; once shared, private cannot be re-entered.
    await saveSkill({
      orgSlug: 'acme',
      slug: 'alice-drafts',
      ...alice,
      description: 'Personal.',
      body: 'Notes.\n',
      visibility: 'org',
    });
    const forBob = await listSkills({ orgSlug: 'acme', ...bob });
    expect(forBob.skills.map((s: { slug: string }) => s.slug)).toEqual([
      'alice-drafts',
    ]);
    expect(forBob.skills[0].owner).toBe('user_alice');

    try {
      await saveSkill({
        orgSlug: 'acme',
        slug: 'alice-drafts',
        ...alice,
        description: 'Personal.',
        body: 'Notes.\n',
        visibility: 'private',
      });
      expect.unreachable('narrowing a shared skill to private must be refused');
    } catch (err) {
      expect(errorCode(err)).toBe('SKILL_PRIVATE_RETIRED');
    }
  });

  it('refuses an edit by a member who neither owns it nor administers the org', async () => {
    await seedSkill(
      'acme',
      'house-voice',
      skillMd({
        name: 'house-voice',
        description: 'Shared.',
        visibility: 'org',
        owner: 'user_alice',
      }),
    );
    const saveSkill = await load('saveSkillForViewer');

    try {
      await saveSkill({
        orgSlug: 'acme',
        slug: 'house-voice',
        ...bob,
        description: 'Hijacked.',
        body: 'Mine now.\n',
      });
      expect.unreachable('a non-owner, non-admin must not edit a shared skill');
    } catch (err) {
      expect(errorCode(err)).toBe('SKILL_FORBIDDEN');
    }
  });

  it('lets an admin curate a shared skill they do not own', async () => {
    await seedSkill(
      'acme',
      'house-voice',
      skillMd({
        name: 'house-voice',
        description: 'Shared.',
        visibility: 'org',
        owner: 'user_alice',
      }),
    );
    const saveSkill = await load('saveSkillForViewer');

    const saved = await saveSkill({
      orgSlug: 'acme',
      slug: 'house-voice',
      ...admin,
      description: 'Curated.',
      body: 'Better wording.\n',
    });

    expect(saved.description).toBe('Curated.');
    expect(saved.owner).toBe('user_alice');
  });

  it('preserves frontmatter the edit surface does not carry', async () => {
    await seedSkill(
      'acme',
      'pdf',
      [
        '---',
        'name: pdf',
        'description: Fill in forms.',
        'visibility: org',
        'license: MIT',
        "allowed-tools: ['Read']",
        '---',
        '',
        'Old body.',
        '',
      ].join('\n'),
    );
    const saveSkill = await load('saveSkillForViewer');
    await saveSkill({
      orgSlug: 'acme',
      slug: 'pdf',
      ...admin,
      description: 'Fill in forms, carefully.',
      body: 'New body.\n',
    });

    const written = await import('node:fs/promises').then((fs) =>
      fs.readFile(
        path.join(configRoot, 'acme', 'skills', 'pdf', 'SKILL.md'),
        'utf-8',
      ),
    );
    expect(written).toContain('license: MIT');
    expect(written).toContain('allowed-tools:');
    expect(written).toContain('New body.');
  });

  it('never writes into another organization’s tree', async () => {
    await seedSkill(
      'globex',
      'house-voice',
      skillMd({ name: 'house-voice', description: 'Globex.' }),
    );
    const saveSkill = await load('saveSkillForViewer');
    const listSkills = await load('listSkillsForViewer');

    await saveSkill({
      orgSlug: 'acme',
      slug: 'house-voice',
      ...alice,
      description: 'Acme.',
      body: 'Acme body.\n',
      visibility: 'org',
    });

    const globex = await listSkills({
      orgSlug: 'globex',
      ...alice,
    });
    expect(globex.skills[0].description).toBe('Globex.');
  });
});

describe('deleteSkill', () => {
  it('reports a no-op when there is nothing to delete', async () => {
    const deleteSkill = await load('deleteSkillForViewer');

    expect(
      await deleteSkill({
        orgSlug: 'acme',
        slug: 'nothing-here',
        ...alice,
      }),
    ).toBe(false);
  });

  it('refuses a member who may not edit the skill', async () => {
    await seedSkill(
      'acme',
      'house-voice',
      skillMd({
        name: 'house-voice',
        description: 'Shared.',
        visibility: 'org',
        owner: 'user_alice',
      }),
    );
    const deleteSkill = await load('deleteSkillForViewer');

    try {
      await deleteSkill({
        orgSlug: 'acme',
        slug: 'house-voice',
        ...bob,
      });
      expect.unreachable('a non-owner, non-admin must not delete');
    } catch (err) {
      expect(errorCode(err)).toBe('SKILL_FORBIDDEN');
    }
  });

  it('deletes the owner’s own skill', async () => {
    await seedSkill(
      'acme',
      'alice-drafts',
      skillMd({
        name: 'alice-drafts',
        description: 'Personal.',
        visibility: 'private',
        owner: 'user_alice',
      }),
    );
    const deleteSkill = await load('deleteSkillForViewer');
    const listSkills = await load('listSkillsForViewer');

    expect(
      await deleteSkill({
        orgSlug: 'acme',
        slug: 'alice-drafts',
        ...alice,
      }),
    ).toBe(true);
    expect((await listSkills({ orgSlug: 'acme', ...alice })).skills).toEqual(
      [],
    );
  });
});

describe('readSkillBundle', () => {
  it('hands a member the whole bundle, SKILL.md verbatim', async () => {
    const doc = skillMd({
      name: 'docx',
      description: 'Word docs.',
      visibility: 'org',
    });
    await seedSkill('acme', 'docx', doc);
    const bundleDir = path.join(configRoot, 'acme', 'skills', 'docx');
    await mkdir(path.join(bundleDir, 'scripts'), { recursive: true });
    await writeFile(
      path.join(bundleDir, 'scripts', 'unpack.py'),
      'print("unpack")\n',
      'utf-8',
    );
    const readSkillBundle = await load('readSkillBundleForViewer');

    const bundle = await readSkillBundle({
      orgSlug: 'acme',
      slug: 'docx',
      ...bob,
    });

    expect(bundle.files.map((f: { path: string }) => f.path)).toEqual([
      'SKILL.md',
      'scripts/unpack.py',
    ]);
    expect(
      Buffer.from(bundle.files[0].contentBase64, 'base64').toString(),
    ).toBe(doc);
  });

  it('reads a private bundle as absent for everyone but its owner', async () => {
    await seedSkill(
      'acme',
      'alice-drafts',
      skillMd({
        name: 'alice-drafts',
        description: 'Personal.',
        visibility: 'private',
        owner: 'user_alice',
      }),
    );
    const readSkillBundle = await load('readSkillBundleForViewer');

    const forAlice = await readSkillBundle({
      orgSlug: 'acme',
      slug: 'alice-drafts',
      ...alice,
    });
    const forBob = await readSkillBundle({
      orgSlug: 'acme',
      slug: 'alice-drafts',
      ...bob,
    });

    expect(forAlice.files.map((f: { path: string }) => f.path)).toEqual([
      'SKILL.md',
    ]);
    expect(forBob).toBeNull();
  });

  it('is null for a bundle the org does not have', async () => {
    const readSkillBundle = await load('readSkillBundleForViewer');

    expect(
      await readSkillBundle({
        orgSlug: 'acme',
        slug: 'missing',
        ...bob,
      }),
    ).toBeNull();
  });

  it('surfaces a malformed SKILL.md instead of staging around it', async () => {
    await seedSkill('acme', 'broken', '# no frontmatter\n');
    const readSkillBundle = await load('readSkillBundleForViewer');

    try {
      await readSkillBundle({
        orgSlug: 'acme',
        slug: 'broken',
        ...bob,
      });
      expect.unreachable('malformed bundle must throw');
    } catch (err) {
      expect(errorCode(err)).toBe('SKILL_MALFORMED');
    }
  });
});

describe('team visibility', () => {
  const redTeamSkill = skillMd({
    name: 'red-notes',
    description: 'Red team notes.',
    visibility: 'team',
    teams: '[team_red]',
    owner: 'user_carol',
  });

  it('resolves a team skill by team overlap, owner, or admin seat', async () => {
    await seedSkill('acme', 'red-notes', redTeamSkill);
    const readSkill = await load('readSkillForViewer');

    const args = { orgSlug: 'acme', slug: 'red-notes' };
    expect(await readSkill({ ...args, ...alice })).not.toBeNull();
    expect(await readSkill({ ...args, ...bob })).toBeNull();
    expect(await readSkill({ ...args, ...admin })).not.toBeNull();
    expect(
      await readSkill({
        ...args,
        ...userViewer('user_carol'),
      }),
    ).not.toBeNull();
  });

  it('resolves a team skill for a project by ITS teams, never a member’s', async () => {
    await seedSkill('acme', 'red-notes', redTeamSkill);
    const readSkill = await load('readSkillForViewer');

    const args = { orgSlug: 'acme', slug: 'red-notes' };
    expect(
      await readSkill({
        ...args,
        viewer: { kind: 'project', teamIds: ['team_red'] },
      }),
    ).not.toBeNull();
    expect(
      await readSkill({
        ...args,
        viewer: { kind: 'project', teamIds: [] },
      }),
    ).toBeNull();
    expect(await readSkill({ ...args, viewer: { kind: 'org' } })).toBeNull();
  });

  it('saves a team skill and strips the teams when it is reshared org-wide', async () => {
    const saveSkill = await load('saveSkillForViewer');

    const created = await saveSkill({
      orgSlug: 'acme',
      slug: 'red-notes',
      ...alice,
      description: 'Red team notes.',
      body: 'Body.\n',
      visibility: 'team',
      teams: ['team_red', 'team_red', ' '],
    });
    expect(created.visibility).toBe('team');
    expect(created.teams).toEqual(['team_red']);

    const reshared = await saveSkill({
      orgSlug: 'acme',
      slug: 'red-notes',
      ...alice,
      description: 'Red team notes.',
      body: 'Body.\n',
      visibility: 'org',
    });
    expect(reshared.visibility).toBe('org');
    expect(reshared.teams).toBeUndefined();
  });

  it('refuses a team skill that would end up with no teams', async () => {
    const saveSkill = await load('saveSkillForViewer');

    try {
      await saveSkill({
        orgSlug: 'acme',
        slug: 'red-notes',
        ...alice,
        description: 'Red team notes.',
        body: 'Body.\n',
        visibility: 'team',
      });
      expect.unreachable('a team skill with no teams must be refused');
    } catch (err) {
      expect(errorCode(err)).toBe('INVALID_SKILL');
    }
  });
});

describe('legacy usage-mode key', () => {
  const legacy = skillMd({
    name: 'chat-helper',
    description: 'Carries the retired usage-mode key.',
    visibility: 'org',
    'usage-mode': 'chat',
  });

  it('reads and lists a legacy bundle as an ordinary skill', async () => {
    await seedSkill('acme', 'chat-helper', legacy);
    const readSkill = await load('readSkillForViewer');
    const listSkills = await load('listSkillsForViewer');

    expect(
      await readSkill({
        orgSlug: 'acme',
        slug: 'chat-helper',
        ...bob,
      }),
    ).not.toBeNull();
    const listing = await listSkills({ orgSlug: 'acme', ...bob });
    expect(listing.skills.map((s: { slug: string }) => s.slug)).toEqual([
      'chat-helper',
    ]);
  });

  it('sheds the retired key on the next edit', async () => {
    await seedSkill('acme', 'chat-helper', legacy);
    const saveSkill = await load('saveSkillForViewer');

    await saveSkill({
      orgSlug: 'acme',
      slug: 'chat-helper',
      ...admin,
      description: 'Retitled.',
      body: 'Body.\n',
    });

    const written = await import('node:fs/promises').then((fs) =>
      fs.readFile(
        path.join(configRoot, 'acme', 'skills', 'chat-helper', 'SKILL.md'),
        'utf-8',
      ),
    );
    expect(written).not.toContain('usage-mode');
  });
});

describe('bundle files and assets', () => {
  async function seedAsset(
    orgSlug: string,
    slug: string,
    relPath: string,
    content: string,
  ): Promise<void> {
    const filePath = path.join(configRoot, orgSlug, 'skills', slug, relPath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf-8');
  }

  it('names every bundle file on the document, sorted with sizes', async () => {
    await seedSkill(
      'acme',
      'pdf-notes',
      skillMd({ name: 'pdf-notes', description: 'Doc.', visibility: 'org' }),
    );
    await seedAsset('acme', 'pdf-notes', 'reference.md', 'ref\n');
    await seedAsset('acme', 'pdf-notes', 'scripts/fill.py', 'print(1)\n');
    const readSkill = await load('readSkillForViewer');

    const doc = await readSkill({
      orgSlug: 'acme',
      slug: 'pdf-notes',
      ...bob,
    });
    expect(doc.files.map((f: { path: string }) => f.path)).toEqual([
      'SKILL.md',
      'reference.md',
      'scripts/fill.py',
    ]);
    expect(doc.files.every((f: { size: number }) => f.size > 0)).toBe(true);
  });

  it('serves one named asset and refuses paths the walk never produces', async () => {
    await seedSkill(
      'acme',
      'pdf-notes',
      skillMd({ name: 'pdf-notes', description: 'Doc.', visibility: 'org' }),
    );
    await seedAsset('acme', 'pdf-notes', 'scripts/fill.py', 'print(1)\n');
    const readSkillAsset = await load('readSkillAssetForViewer');

    const asset = await readSkillAsset({
      orgSlug: 'acme',
      slug: 'pdf-notes',
      path: 'scripts/fill.py',
      ...bob,
    });
    expect(asset).not.toBeNull();
    expect(Buffer.from(asset.contentBase64, 'base64').toString('utf-8')).toBe(
      'print(1)\n',
    );

    for (const bad of [
      '../escape.md',
      '/etc/passwd',
      '.hidden/file.md',
      'node_modules/x.js',
      'missing.md',
    ]) {
      expect(
        await readSkillAsset({
          orgSlug: 'acme',
          slug: 'pdf-notes',
          path: bad,
          ...bob,
        }),
      ).toBeNull();
    }
  });

  it('hides assets of a skill the viewer may not see', async () => {
    await seedSkill(
      'acme',
      'alice-drafts',
      skillMd({
        name: 'alice-drafts',
        description: 'Personal.',
        visibility: 'private',
        owner: 'user_alice',
      }),
    );
    const readSkillAsset = await load('readSkillAssetForViewer');

    expect(
      await readSkillAsset({
        orgSlug: 'acme',
        slug: 'alice-drafts',
        path: 'SKILL.md',
        ...bob,
      }),
    ).toBeNull();
  });
});
