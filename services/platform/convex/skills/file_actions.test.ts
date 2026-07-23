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

const alice = { viewerUserId: 'user_alice', isOrgAdmin: false };
const bob = { viewerUserId: 'user_bob', isOrgAdmin: false };
const admin = { viewerUserId: 'user_admin', isOrgAdmin: true };

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
