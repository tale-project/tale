// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Replace the Convex function builders with identity functions so each loaded
// action is the plain `{ args, returns, handler }` object and its handler can
// be driven directly against a real temporary config tree.
vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    action: (config: Record<string, unknown>) => config,
    internalAction: (config: Record<string, unknown>) => config,
  };
});

// oxlint-disable-next-line typescript/no-explicit-any -- builders mocked to identity (third-party gap per AGENTS.md)
type Handler = { handler: (ctx: unknown, args: unknown) => Promise<any> };

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

async function load(name: string): Promise<Handler> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above
  const mod = (await import('./file_actions')) as unknown as Record<
    string,
    Handler
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
  if (err instanceof ConvexError) {
    const data: unknown = err.data;
    if (typeof data === 'object' && data !== null && 'code' in data) {
      return String((data as { code: unknown }).code);
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
    const listSkills = await load('listSkills');

    const forAlice = await listSkills.handler(null, {
      orgSlug: 'acme',
      ...alice,
    });
    const forBob = await listSkills.handler(null, { orgSlug: 'acme', ...bob });
    const forAdmin = await listSkills.handler(null, {
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
    const listSkills = await load('listSkills');

    const asBob = await listSkills.handler(null, { orgSlug: 'acme', ...bob });
    const asAdmin = await listSkills.handler(null, {
      orgSlug: 'acme',
      ...admin,
    });
    const asAlice = await listSkills.handler(null, {
      orgSlug: 'acme',
      ...alice,
    });

    expect(asBob.skills[0].canEdit).toBe(false);
    expect(asAdmin.skills[0].canEdit).toBe(true);
    expect(asAlice.skills[0].canEdit).toBe(true);
  });

  it('reports a malformed bundle with its org-relative path', async () => {
    await seedSkill('acme', 'broken', '# no frontmatter\n');
    const listSkills = await load('listSkills');

    const listing = await listSkills.handler(null, {
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
    const listSkills = await load('listSkills');

    const acme = await listSkills.handler(null, { orgSlug: 'acme', ...alice });
    const globex = await listSkills.handler(null, {
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
    const readSkill = await load('readSkill');

    const mine = await readSkill.handler(null, {
      orgSlug: 'acme',
      slug: 'alice-drafts',
      ...alice,
    });
    expect(mine.body).toBe('Secret notes.\n');

    // Absent, not forbidden: acknowledging it would already leak its existence.
    expect(
      await readSkill.handler(null, {
        orgSlug: 'acme',
        slug: 'alice-drafts',
        ...bob,
      }),
    ).toBeNull();
    expect(
      await readSkill.handler(null, {
        orgSlug: 'acme',
        slug: 'alice-drafts',
        ...admin,
      }),
    ).toBeNull();
  });

  it('reports a malformed bundle instead of pretending it is absent', async () => {
    await seedSkill('acme', 'broken', '---\nname: broken\n');
    const readSkill = await load('readSkill');

    try {
      await readSkill.handler(null, {
        orgSlug: 'acme',
        slug: 'broken',
        ...alice,
      });
      expect.unreachable('a malformed bundle must not read as absent');
    } catch (err) {
      expect(errorCode(err)).toBe('SKILL_MALFORMED');
      expect((err as ConvexError<{ message: string }>).data.message).toContain(
        'skills/broken/SKILL.md',
      );
    }
  });

  it('rejects a slug that is not a bundle name', async () => {
    const readSkill = await load('readSkill');

    await expect(
      readSkill.handler(null, {
        orgSlug: 'acme',
        slug: '../../etc',
        ...alice,
      }),
    ).rejects.toBeInstanceOf(ConvexError);
  });
});

describe('saveSkill', () => {
  it('creates a private skill owned by its author', async () => {
    const saveSkill = await load('saveSkill');

    const saved = await saveSkill.handler(null, {
      orgSlug: 'acme',
      slug: 'alice-drafts',
      ...alice,
      description: 'Personal.',
      body: 'Notes.\n',
    });

    expect(saved.visibility).toBe('private');
    expect(saved.owner).toBe('user_alice');
    expect(saved.canEdit).toBe(true);

    const listSkills = await load('listSkills');
    const forBob = await listSkills.handler(null, { orgSlug: 'acme', ...bob });
    expect(forBob.skills).toEqual([]);
  });

  it('shares a skill by flipping its visibility, with no other bookkeeping', async () => {
    const saveSkill = await load('saveSkill');
    const listSkills = await load('listSkills');

    await saveSkill.handler(null, {
      orgSlug: 'acme',
      slug: 'alice-drafts',
      ...alice,
      description: 'Personal.',
      body: 'Notes.\n',
    });
    expect(
      (await listSkills.handler(null, { orgSlug: 'acme', ...bob })).skills,
    ).toEqual([]);

    await saveSkill.handler(null, {
      orgSlug: 'acme',
      slug: 'alice-drafts',
      ...alice,
      description: 'Personal.',
      body: 'Notes.\n',
      visibility: 'org',
    });

    const forBob = await listSkills.handler(null, { orgSlug: 'acme', ...bob });
    expect(forBob.skills.map((s: { slug: string }) => s.slug)).toEqual([
      'alice-drafts',
    ]);
    expect(forBob.skills[0].owner).toBe('user_alice');
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
    const saveSkill = await load('saveSkill');

    try {
      await saveSkill.handler(null, {
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
    const saveSkill = await load('saveSkill');

    const saved = await saveSkill.handler(null, {
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
    const saveSkill = await load('saveSkill');
    await saveSkill.handler(null, {
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
    const saveSkill = await load('saveSkill');
    const listSkills = await load('listSkills');

    await saveSkill.handler(null, {
      orgSlug: 'acme',
      slug: 'house-voice',
      ...alice,
      description: 'Acme.',
      body: 'Acme body.\n',
      visibility: 'org',
    });

    const globex = await listSkills.handler(null, {
      orgSlug: 'globex',
      ...alice,
    });
    expect(globex.skills[0].description).toBe('Globex.');
  });
});

describe('deleteSkill', () => {
  it('reports a no-op when there is nothing to delete', async () => {
    const deleteSkill = await load('deleteSkill');

    expect(
      await deleteSkill.handler(null, {
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
    const deleteSkill = await load('deleteSkill');

    try {
      await deleteSkill.handler(null, {
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
    const deleteSkill = await load('deleteSkill');
    const listSkills = await load('listSkills');

    expect(
      await deleteSkill.handler(null, {
        orgSlug: 'acme',
        slug: 'alice-drafts',
        ...alice,
      }),
    ).toBe(true);
    expect(
      (await listSkills.handler(null, { orgSlug: 'acme', ...alice })).skills,
    ).toEqual([]);
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
    const readSkillBundle = await load('readSkillBundle');

    const bundle = await readSkillBundle.handler(null, {
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
    const readSkillBundle = await load('readSkillBundle');

    const forAlice = await readSkillBundle.handler(null, {
      orgSlug: 'acme',
      slug: 'alice-drafts',
      ...alice,
    });
    const forBob = await readSkillBundle.handler(null, {
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
    const readSkillBundle = await load('readSkillBundle');

    expect(
      await readSkillBundle.handler(null, {
        orgSlug: 'acme',
        slug: 'missing',
        ...bob,
      }),
    ).toBeNull();
  });

  it('surfaces a malformed SKILL.md instead of staging around it', async () => {
    await seedSkill('acme', 'broken', '# no frontmatter\n');
    const readSkillBundle = await load('readSkillBundle');

    try {
      await readSkillBundle.handler(null, {
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
    const readSkill = await load('readSkill');

    const args = { orgSlug: 'acme', slug: 'red-notes' };
    expect(await readSkill.handler(null, { ...args, ...alice })).not.toBeNull();
    expect(await readSkill.handler(null, { ...args, ...bob })).toBeNull();
    expect(await readSkill.handler(null, { ...args, ...admin })).not.toBeNull();
    expect(
      await readSkill.handler(null, {
        ...args,
        ...userViewer('user_carol'),
      }),
    ).not.toBeNull();
  });

  it('resolves a team skill for a project by ITS teams, never a member’s', async () => {
    await seedSkill('acme', 'red-notes', redTeamSkill);
    const readSkill = await load('readSkill');

    const args = { orgSlug: 'acme', slug: 'red-notes' };
    expect(
      await readSkill.handler(null, {
        ...args,
        viewer: { kind: 'project', teamIds: ['team_red'] },
      }),
    ).not.toBeNull();
    expect(
      await readSkill.handler(null, {
        ...args,
        viewer: { kind: 'project', teamIds: [] },
      }),
    ).toBeNull();
    expect(
      await readSkill.handler(null, { ...args, viewer: { kind: 'org' } }),
    ).toBeNull();
  });

  it('saves a team skill and strips the teams when it is reshared org-wide', async () => {
    const saveSkill = await load('saveSkill');

    const created = await saveSkill.handler(null, {
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

    const reshared = await saveSkill.handler(null, {
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
    const saveSkill = await load('saveSkill');

    try {
      await saveSkill.handler(null, {
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

describe('usage mode and surfaces', () => {
  const chatOnly = skillMd({
    name: 'chat-helper',
    description: 'Chat only.',
    visibility: 'org',
    'usage-mode': 'chat',
  });

  it('hides a chat-only skill from the agent surface and vice versa', async () => {
    await seedSkill('acme', 'chat-helper', chatOnly);
    const readSkill = await load('readSkill');

    const args = { orgSlug: 'acme', slug: 'chat-helper', ...bob };
    expect(
      await readSkill.handler(null, { ...args, surface: 'chat' }),
    ).not.toBeNull();
    expect(
      await readSkill.handler(null, { ...args, surface: 'agent' }),
    ).toBeNull();
    expect(await readSkill.handler(null, args)).not.toBeNull();
  });

  it('narrows listings to the asking surface', async () => {
    await seedSkill('acme', 'chat-helper', chatOnly);
    await seedSkill(
      'acme',
      'house-voice',
      skillMd({ name: 'house-voice', description: 'Any.', visibility: 'org' }),
    );
    const listSkills = await load('listSkills');

    const agentSide = await listSkills.handler(null, {
      orgSlug: 'acme',
      ...bob,
      surface: 'agent',
    });
    expect(agentSide.skills.map((s: { slug: string }) => s.slug)).toEqual([
      'house-voice',
    ]);
  });

  it('keeps the usage mode across an edit that does not touch it', async () => {
    await seedSkill('acme', 'chat-helper', chatOnly);
    const saveSkill = await load('saveSkill');

    const saved = await saveSkill.handler(null, {
      orgSlug: 'acme',
      slug: 'chat-helper',
      ...admin,
      description: 'Chat only, retitled.',
      body: 'Body.\n',
    });
    expect(saved.usageMode).toBe('chat');
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
    const readSkill = await load('readSkill');

    const doc = await readSkill.handler(null, {
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
    const readSkillAsset = await load('readSkillAsset');

    const asset = await readSkillAsset.handler(null, {
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
        await readSkillAsset.handler(null, {
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
    const readSkillAsset = await load('readSkillAsset');

    expect(
      await readSkillAsset.handler(null, {
        orgSlug: 'acme',
        slug: 'alice-drafts',
        path: 'SKILL.md',
        ...bob,
      }),
    ).toBeNull();
  });
});

describe('uploadSkillBundle', () => {
  async function zipOf(files: Record<string, string>): Promise<Buffer> {
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    for (const [name, content] of Object.entries(files)) {
      zip.file(name, content);
    }
    return zip.generateAsync({ type: 'nodebuffer' });
  }

  interface UploadCtxOptions {
    blob?: Buffer | null;
    intentMatch?: boolean;
  }

  function uploadCtx(options: UploadCtxOptions = {}) {
    const mutations: string[] = [];
    const deleted: string[] = [];
    return {
      mutations,
      deleted,
      ctx: {
        runMutation: (ref: unknown, _args: unknown) => {
          // getFunctionName needs the generated ref; suffix-match its string
          // form instead so the identity-mocked builders stay out of it.
          const name = String(
            (ref as Record<symbol, unknown>)[Symbol.for('functionName')] ?? ref,
          );
          mutations.push(name);
          if (name.includes('verifySkillUploadIntent')) {
            return Promise.resolve(options.intentMatch ?? true);
          }
          return Promise.resolve(null);
        },
        storage: {
          get: (_id: string) => {
            const buf = options.blob;
            if (buf === null) return Promise.resolve(null);
            const bytes = buf ?? Buffer.alloc(0);
            return Promise.resolve(
              new Blob([new Uint8Array(bytes)], { type: 'application/zip' }),
            );
          },
          delete: (id: string) => {
            deleted.push(id);
            return Promise.resolve();
          },
        },
      },
    };
  }

  const STORAGE_ID = 'st_1' as never;

  function uploadArgs(extra: Record<string, unknown> = {}) {
    return {
      organizationId: 'org_acme',
      orgSlug: 'acme',
      storageId: STORAGE_ID,
      ...alice,
      ...extra,
    };
  }

  it('persists an unmarked bundle as the uploader’s private skill', async () => {
    const blob = await zipOf({
      'invoice-audit/SKILL.md': skillMd({
        name: 'invoice-audit',
        description: 'How we audit an invoice.',
      }),
      'invoice-audit/reference.md': 'ref\n',
    });
    const { ctx, deleted } = uploadCtx({ blob });
    const uploadSkillBundle = await load('uploadSkillBundle');

    const result = await uploadSkillBundle.handler(ctx, uploadArgs());
    expect(result).toEqual({ ok: true, slug: 'invoice-audit' });
    // The staged blob never outlives the call.
    expect(deleted).toEqual([STORAGE_ID]);

    const readSkill = await load('readSkill');
    const mine = await readSkill.handler(null, {
      orgSlug: 'acme',
      slug: 'invoice-audit',
      ...alice,
    });
    expect(mine.visibility).toBe('private');
    expect(mine.owner).toBe('user_alice');
    expect(mine.files.map((f: { path: string }) => f.path)).toEqual([
      'SKILL.md',
      'reference.md',
    ]);
    expect(
      await readSkill.handler(null, {
        orgSlug: 'acme',
        slug: 'invoice-audit',
        ...bob,
      }),
    ).toBeNull();
  });

  it('honors a declared visibility verbatim', async () => {
    const blob = await zipOf({
      'SKILL.md': skillMd({
        name: 'house-voice',
        description: 'Shared on purpose.',
        visibility: 'org',
      }),
    });
    const { ctx } = uploadCtx({ blob });
    const uploadSkillBundle = await load('uploadSkillBundle');

    await uploadSkillBundle.handler(ctx, uploadArgs());

    const readSkill = await load('readSkill');
    const forBob = await readSkill.handler(null, {
      orgSlug: 'acme',
      slug: 'house-voice',
      ...bob,
    });
    expect(forBob.visibility).toBe('org');
    // Attribution adopted for an ownerless shared bundle.
    expect(forBob.owner).toBe('user_alice');
  });

  it('asks for confirmation before replacing, then gates the replace on edit rights', async () => {
    await seedSkill(
      'acme',
      'house-voice',
      skillMd({
        name: 'house-voice',
        description: 'The current one.',
        visibility: 'org',
        owner: 'user_carol',
      }),
    );
    const blob = await zipOf({
      'SKILL.md': skillMd({
        name: 'house-voice',
        description: 'The replacement.',
        visibility: 'org',
      }),
    });
    const uploadSkillBundle = await load('uploadSkillBundle');

    const first = await uploadSkillBundle.handler(
      uploadCtx({ blob }).ctx,
      uploadArgs(),
    );
    expect(first).toEqual({
      ok: false,
      status: 'needs_confirm',
      slug: 'house-voice',
    });

    // Alice neither owns it nor administers the org.
    try {
      await uploadSkillBundle.handler(
        uploadCtx({ blob }).ctx,
        uploadArgs({ force: true }),
      );
      expect.unreachable('replace by a non-editor must be refused');
    } catch (err) {
      expect(errorCode(err)).toBe('SKILL_FORBIDDEN');
    }

    const replaced = await uploadSkillBundle.handler(
      uploadCtx({ blob }).ctx,
      uploadArgs({ force: true, ...admin }),
    );
    expect(replaced).toEqual({ ok: true, slug: 'house-voice' });

    const readSkill = await load('readSkill');
    const doc = await readSkill.handler(null, {
      orgSlug: 'acme',
      slug: 'house-voice',
      ...bob,
    });
    expect(doc.description).toBe('The replacement.');
  });

  it('refuses a blob the org does not own, before reading it', async () => {
    const { ctx, deleted } = uploadCtx({ intentMatch: false });
    const uploadSkillBundle = await load('uploadSkillBundle');

    try {
      await uploadSkillBundle.handler(ctx, uploadArgs());
      expect.unreachable('unowned storage must be refused');
    } catch (err) {
      expect(errorCode(err)).toBe('STORAGE_NOT_OWNED');
    }
    expect(deleted).toEqual([]);
  });

  it('cleans up and refuses an invalid archive', async () => {
    const { ctx, deleted } = uploadCtx({ blob: Buffer.from('not a zip') });
    const uploadSkillBundle = await load('uploadSkillBundle');

    try {
      await uploadSkillBundle.handler(ctx, uploadArgs());
      expect.unreachable('garbage must be refused');
    } catch (err) {
      expect(errorCode(err)).toBe('INVALID_BUNDLE');
    }
    expect(deleted).toEqual([STORAGE_ID]);
  });
});
