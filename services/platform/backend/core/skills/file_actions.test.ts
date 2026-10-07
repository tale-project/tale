// @vitest-environment node

import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { parseEntityTagList } from '@tale/shared/http/entity-tag';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../../lib/shared/errors/app-error';
import type { OrgSkill } from '../../../lib/skills/listing';
import { parseSkillMd } from '../../../lib/skills/parse';
import type { ParsedBundle } from './bundle_zip';
import {
  describeBundleWrite,
  normalizedBundleFiles,
  prepareBundleWrite,
} from './file_actions';

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
  opts: {
    teamIds?: string[];
    isOrgAdmin?: boolean;
    mayPublishOrgWide?: boolean;
  } = {},
) {
  return {
    viewer: {
      kind: 'user' as const,
      userId,
      teamIds: opts.teamIds ?? [],
      isOrgAdmin: opts.isOrgAdmin ?? false,
    },
    // The organization's default (`everyone`): every member may publish. A
    // save reads it; the list, read and delete functions ignore it.
    mayPublishOrgWide: opts.mayPublishOrgWide ?? true,
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

function errorMessage(err: unknown): string | undefined {
  if (err instanceof AppError) {
    const data: unknown = err.data;
    if (typeof data === 'object' && data !== null && 'message' in data) {
      return String(data.message);
    }
  }
  return undefined;
}

/** The structured `data` a refusal explains itself with. */
function errorData(err: unknown): unknown {
  if (err instanceof AppError) {
    const data: unknown = err.data;
    if (typeof data === 'object' && data !== null && 'data' in data) {
      return data.data;
    }
  }
  return undefined;
}

describe('listSkills', () => {
  it('shows a private skill only to its owner [SKILL-R2]', async () => {
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
    // The absolute server path never crosses the wire — not in `path`, and
    // not inside the sentence either.
    expect(listing.failures[0].path).not.toContain(configRoot);
    expect(listing.failures[0].message).not.toContain(configRoot);
    expect(listing.failures[0].message).toContain('skills/broken');
  });

  it('lists each organization separately, in both directions [SKILL-R4]', async () => {
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
  it('reads a member’s own private skill and hides someone else’s [SKILL-R2]', async () => {
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
  it('creates an org skill owned by its author [SKILL-R6]', async () => {
    const saveSkill = await load('saveSkillForViewer');

    const { skill: saved } = await saveSkill({
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

  it('says whether the save created the bundle or updated one', async () => {
    const saveSkill = await load('saveSkillForViewer');
    const args = {
      orgSlug: 'acme',
      slug: 'house-voice',
      ...alice,
      description: 'First.',
      body: 'Notes.\n',
    };
    // The door's 201 / 200 rides on this: nothing under the slug when the
    // save ran is a create, anything else an update — a repeat with a
    // different body included.
    expect((await saveSkill(args)).created).toBe(true);
    expect((await saveSkill({ ...args, description: 'Second.' })).created).toBe(
      false,
    );
  });

  it('refuses to replace an existing bundle when asked to create only [SKILL-R10]', async () => {
    const saveSkill = await load('saveSkillForViewer');
    await saveSkill({
      orgSlug: 'acme',
      slug: 'house-voice',
      ...alice,
      description: 'First.',
      body: 'Original.\n',
    });

    try {
      await saveSkill({
        orgSlug: 'acme',
        slug: 'house-voice',
        ...admin,
        precondition: { ifNoneMatch: { kind: 'any' } },
        description: 'Second.',
        body: 'Replacement.\n',
      });
      expect.unreachable(
        'a create-only save over an existing bundle must be refused',
      );
    } catch (err) {
      expect(errorCode(err)).toBe('SKILL_EXISTS');
    }
    const readSkill = await load('readSkillForViewer');
    const kept = await readSkill({
      orgSlug: 'acme',
      slug: 'house-voice',
      ...bob,
    });
    expect(kept.body).toBe('Original.\n');
    expect(kept.description).toBe('First.');

    // The same flag on a slug nobody holds is an ordinary create.
    const { skill: created } = await saveSkill({
      orgSlug: 'acme',
      slug: 'fresh',
      ...alice,
      precondition: { ifNoneMatch: { kind: 'any' } },
      description: 'New.',
      body: 'New.\n',
    });
    expect(created.slug).toBe('fresh');
  });

  it('names the version every view carries, and moves it with each save of the document', async () => {
    const saveSkill = await load('saveSkillForViewer');
    const readSkill = await load('readSkillForViewer');
    const listSkills = await load('listSkillsForViewer');

    const { skill: first } = await saveSkill({
      orgSlug: 'acme',
      slug: 'house-voice',
      ...alice,
      description: 'First.',
      body: 'One.\n',
    });
    expect(first.etag).toMatch(/^"[0-9a-f]{64}"$/);
    expect(first.updatedAt).toBeGreaterThan(0);
    const read = await readSkill({
      orgSlug: 'acme',
      slug: 'house-voice',
      ...bob,
    });
    expect(read.etag).toBe(first.etag);
    expect(read.updatedAt).toBe(first.updatedAt);
    const listed = await listSkills({ orgSlug: 'acme', ...bob });
    expect(listed.skills[0]).toMatchObject({
      slug: 'house-voice',
      etag: first.etag,
      updatedAt: first.updatedAt,
    });

    const { skill: second } = await saveSkill({
      orgSlug: 'acme',
      slug: 'house-voice',
      ...alice,
      description: 'First.',
      body: 'Two.\n',
    });
    expect(second.etag).not.toBe(first.etag);
    expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt);
  });

  it('writes nothing for a save that would store the document already there — same tag, same updatedAt, no history entry [SKILL-R12]', async () => {
    const saveSkill = await load('saveSkillForViewer');
    const readSkill = await load('readSkillForViewer');
    const args = {
      orgSlug: 'acme',
      slug: 'house-voice',
      ...alice,
      description: 'First.',
      body: 'One.\n',
    };
    const { skill: first } = await saveSkill(args);
    const skillMdPath = path.join(
      configRoot,
      'acme',
      'skills',
      'house-voice',
      'SKILL.md',
    );
    const historyDir = path.join(
      configRoot,
      'acme',
      'skills',
      '.history',
      'house-voice',
    );
    const historyEntries = (): Promise<string[]> =>
      readdir(historyDir).catch((err: unknown) => {
        if ((err as { code?: string }).code === 'ENOENT') return [];
        throw err;
      });
    // Age the document so an untouched mtime is provable: a rewrite inside
    // the same millisecond would hide behind the floored timestamp.
    const aged = new Date('2020-01-01T00:00:00Z');
    await utimes(skillMdPath, aged, aged);
    const read = await readSkill({
      orgSlug: 'acme',
      slug: 'house-voice',
      ...bob,
    });
    expect(read.updatedAt).toBe(aged.getTime());

    // The identical save (the 2026-09-13 round-e evaluation, E6-03): the
    // stored tag, the stored updatedAt, the file and its history untouched.
    const again = await saveSkill(args);
    expect(again.created).toBe(false);
    expect(again.skill.etag).toBe(first.etag);
    expect(again.skill.updatedAt).toBe(aged.getTime());
    expect(Math.floor((await stat(skillMdPath)).mtimeMs)).toBe(aged.getTime());
    expect(await historyEntries()).toEqual([]);

    // A save that changes the document moves both and snapshots the old one…
    const { skill: changed } = await saveSkill({ ...args, body: 'Two.\n' });
    expect(changed.etag).not.toBe(first.etag);
    expect(changed.updatedAt).toBeGreaterThan(aged.getTime());
    expect((await historyEntries()).length).toBe(1);
    // …and an identical save after it is a no-op again.
    const settled = await saveSkill({ ...args, body: 'Two.\n' });
    expect(settled.skill.etag).toBe(changed.etag);
    expect(settled.skill.updatedAt).toBe(changed.updatedAt);
    expect((await historyEntries()).length).toBe(1);
  });

  it('evaluates the preconditions before the no-op: a stale If-Match on an identical body is still refused', async () => {
    const saveSkill = await load('saveSkillForViewer');
    const args = {
      orgSlug: 'acme',
      slug: 'house-voice',
      ...alice,
      description: 'First.',
      body: 'One.\n',
    };
    const { skill: stored } = await saveSkill(args);
    try {
      await saveSkill({
        ...args,
        precondition: { ifMatch: parseEntityTagList('"stale"') },
      });
      expect.unreachable(
        'a stale If-Match must be refused even when the body changes nothing',
      );
    } catch (err) {
      expect(errorCode(err)).toBe('SKILL_STALE');
      expect(errorData(err)).toEqual({ etag: stored.etag });
    }
  });

  it('honours If-Match under RFC 9110 strong comparison and names the current tag on a refusal [SKILL-R11]', async () => {
    const saveSkill = await load('saveSkillForViewer');
    const readSkill = await load('readSkillForViewer');
    const { skill: stored } = await saveSkill({
      orgSlug: 'acme',
      slug: 'house-voice',
      ...alice,
      description: 'First.',
      body: 'One.\n',
    });
    const tags = (header: string) => parseEntityTagList(header);
    const attempt = (header: string) =>
      saveSkill({
        orgSlug: 'acme',
        slug: 'house-voice',
        ...alice,
        precondition: { ifMatch: tags(header) },
        description: 'Second.',
        body: 'Two.\n',
      });

    // A stale tag, a weak spelling of the right tag, and a malformed
    // value all fail — and the file on disk is untouched.
    for (const header of ['"stale"', `W/${stored.etag}`, 'not-a-tag']) {
      try {
        await attempt(header);
        expect.unreachable(`If-Match ${header} must be refused`);
      } catch (err) {
        expect(errorCode(err)).toBe('SKILL_STALE');
        expect(errorData(err)).toEqual({ etag: stored.etag });
      }
      const kept = await readSkill({
        orgSlug: 'acme',
        slug: 'house-voice',
        ...bob,
      });
      expect(kept.body).toBe('One.\n');
      expect(kept.etag).toBe(stored.etag);
    }

    // The current tag — alone or in a list, with `*` too — lets the save
    // through, and the answer names the new version.
    const { skill: saved } = await attempt(`"other", ${stored.etag}`);
    expect(saved.body).toBe('Two.\n');
    expect(saved.etag).not.toBe(stored.etag);
    const { skill: anyRep } = await saveSkill({
      orgSlug: 'acme',
      slug: 'house-voice',
      ...alice,
      precondition: { ifMatch: { kind: 'any' } },
      description: 'Third.',
      body: 'Three.\n',
    });
    expect(anyRep.body).toBe('Three.\n');
  });

  it('refuses If-Match on a slug that holds nothing — nothing to match, nothing written', async () => {
    const saveSkill = await load('saveSkillForViewer');
    const readSkill = await load('readSkillForViewer');
    for (const ifMatch of [{ kind: 'any' }, parseEntityTagList('"x"')]) {
      try {
        await saveSkill({
          orgSlug: 'acme',
          slug: 'never-made',
          ...alice,
          precondition: { ifMatch },
          description: 'New.',
          body: 'New.\n',
        });
        expect.unreachable('If-Match on an absent slug must be refused');
      } catch (err) {
        expect(errorCode(err)).toBe('SKILL_STALE');
        expect(errorData(err)).toEqual({ etag: null });
      }
    }
    expect(
      await readSkill({ orgSlug: 'acme', slug: 'never-made', ...alice }),
    ).toBeNull();
  });

  it('evaluates If-Match before If-None-Match, and a listed If-None-Match tag against the current one weakly', async () => {
    const saveSkill = await load('saveSkillForViewer');
    const { skill: stored } = await saveSkill({
      orgSlug: 'acme',
      slug: 'house-voice',
      ...alice,
      description: 'First.',
      body: 'One.\n',
    });
    // Both fail; §13.2.2 says If-Match is answered first.
    try {
      await saveSkill({
        orgSlug: 'acme',
        slug: 'house-voice',
        ...alice,
        precondition: {
          ifMatch: parseEntityTagList('"stale"'),
          ifNoneMatch: { kind: 'any' },
        },
        description: 'Second.',
        body: 'Two.\n',
      });
      expect.unreachable();
    } catch (err) {
      expect(errorCode(err)).toBe('SKILL_STALE');
    }
    // A weak spelling of the current tag in If-None-Match matches (weak
    // comparison) and refuses the write as SKILL_EXISTS.
    try {
      await saveSkill({
        orgSlug: 'acme',
        slug: 'house-voice',
        ...alice,
        precondition: { ifNoneMatch: parseEntityTagList(`W/${stored.etag}`) },
        description: 'Second.',
        body: 'Two.\n',
      });
      expect.unreachable();
    } catch (err) {
      expect(errorCode(err)).toBe('SKILL_EXISTS');
      expect(errorData(err)).toEqual({ etag: stored.etag });
    }
    // A tag that is not the current one matches nothing: the write goes on.
    const { skill: saved } = await saveSkill({
      orgSlug: 'acme',
      slug: 'house-voice',
      ...alice,
      precondition: { ifNoneMatch: parseEntityTagList('"other"') },
      description: 'Second.',
      body: 'Two.\n',
    });
    expect(saved.body).toBe('Two.\n');
  });

  it('answers the permission gate before the precondition', async () => {
    const saveSkill = await load('saveSkillForViewer');
    await saveSkill({
      orgSlug: 'acme',
      slug: 'house-voice',
      ...alice,
      description: 'Alice’s.',
      body: 'One.\n',
      visibility: 'team',
      teams: ['team_red'],
    });
    try {
      await saveSkill({
        orgSlug: 'acme',
        slug: 'house-voice',
        ...bob,
        precondition: { ifMatch: parseEntityTagList('"stale"') },
        description: 'Bob’s.',
        body: 'Two.\n',
      });
      expect.unreachable();
    } catch (err) {
      expect(errorCode(err)).toBe('SKILL_FORBIDDEN');
    }
  });

  it('sets, keeps and drops the model-invocation flag', async () => {
    const saveSkill = await load('saveSkillForViewer');
    const base = {
      orgSlug: 'acme',
      slug: 'house-voice',
      ...alice,
      description: 'Flagged.',
      body: 'Body.\n',
    };
    const { skill: set } = await saveSkill({
      ...base,
      disableModelInvocation: true,
    });
    expect(set.disableModelInvocation).toBe(true);
    const { skill: kept } = await saveSkill(base);
    expect(kept.disableModelInvocation).toBe(true);
    const { skill: dropped } = await saveSkill({
      ...base,
      disableModelInvocation: false,
    });
    expect(dropped.disableModelInvocation).toBeUndefined();
    const onDisk = await readFile(
      path.join(configRoot, 'acme', 'skills', 'house-voice', 'SKILL.md'),
      'utf-8',
    );
    expect(onDisk).not.toContain('disable-model-invocation');
  });

  it('keeps icon and labels when the edit omits them, and clears them on null', async () => {
    const saveSkill = await load('saveSkillForViewer');
    const { skill: first } = await saveSkill({
      orgSlug: 'acme',
      slug: 'house-voice',
      ...alice,
      description: 'Decorated.',
      body: 'Body.\n',
      icon: 'lucide:flask-conical',
      labels: ['probe', 'inert'],
    });
    expect(first.icon).toBe('lucide:flask-conical');
    expect(first.labels).toEqual(['probe', 'inert']);

    const { skill: merged } = await saveSkill({
      orgSlug: 'acme',
      slug: 'house-voice',
      ...alice,
      description: 'Still decorated.',
      body: 'Body.\n',
    });
    expect(merged.icon).toBe('lucide:flask-conical');
    expect(merged.labels).toEqual(['probe', 'inert']);

    const { skill: cleared } = await saveSkill({
      orgSlug: 'acme',
      slug: 'house-voice',
      ...alice,
      description: 'Plain.',
      body: 'Body.\n',
      icon: null,
      labels: null,
    });
    expect(cleared.icon).toBeUndefined();
    expect(cleared.labels).toBeUndefined();
    const readSkill = await load('readSkillForViewer');
    const onDisk = await readSkill({
      orgSlug: 'acme',
      slug: 'house-voice',
      ...alice,
    });
    expect(onDisk.icon).toBeUndefined();
    expect(onDisk.labels).toBeUndefined();
  });

  it('refuses to mint a private skill [SKILL-R3]', async () => {
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

  it('keeps a pre-existing private skill private, and shares it with one flip [SKILL-R3]', async () => {
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
    const { skill: edited } = await saveSkill({
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

  it('refuses an edit by a member who neither owns it nor administers the org [SKILL-R5]', async () => {
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

  it('lets an admin curate a shared skill they do not own [SKILL-R5]', async () => {
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

    const { skill: saved } = await saveSkill({
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

  it('never writes into another organization’s tree [SKILL-R4]', async () => {
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

describe('an editor normalizing a legacy audience', () => {
  it('rechecks a padded stored team even when the edit omits teams', async () => {
    await seedSkill(
      'acme',
      'legacy-team',
      skillMd({
        name: 'legacy-team',
        description: 'Legacy.',
        visibility: 'team',
        owner: alice.viewer.userId,
        teams: '[" t-foreign "]',
      }),
    );
    const saveSkill = await load('saveSkillForViewer');
    const refusal = new AppError({
      code: 'TEAM_ACCESS_DENIED',
      message: 'Not your team.',
    });
    const assertTeamsAssignable = vi.fn(async () => {
      throw refusal;
    });
    await expect(
      saveSkill({
        orgSlug: 'acme',
        slug: 'legacy-team',
        ...alice,
        description: 'Edited.',
        body: 'Body-only edit.',
        assertTeamsAssignable,
      }),
    ).rejects.toBe(refusal);
    expect(assertTeamsAssignable).toHaveBeenCalledExactlyOnceWith([
      't-foreign',
    ]);
    expect(
      await readFile(
        path.join(configRoot, 'acme', 'skills', 'legacy-team', 'SKILL.md'),
        'utf8',
      ),
    ).toContain('" t-foreign "');
  });
});

describe('an organization that reserves organization-wide skills', () => {
  // A member the organization's `skill_sharing` policy does not let publish:
  // in team_red, no admin seat, no `tale:skills.publish` grant.
  const carol = userViewer('user_carol', {
    teamIds: ['team_red'],
    mayPublishOrgWide: false,
  });
  const publisher = userViewer('user_dave', { mayPublishOrgWide: true });

  async function refusalCode(work: Promise<unknown>): Promise<unknown> {
    try {
      await work;
      return undefined;
    } catch (err) {
      return errorCode(err);
    }
  }

  async function stored(slug: string): Promise<string> {
    return readFile(
      path.join(configRoot, 'acme', 'skills', slug, 'SKILL.md'),
      'utf8',
    );
  }

  it('refuses creating an organization-wide skill, the default audience included, and writes nothing [SKILL-R7]', async () => {
    const saveSkill = await load('saveSkillForViewer');
    for (const visibility of [undefined, 'org'] as const) {
      expect(
        await refusalCode(
          saveSkill({
            orgSlug: 'acme',
            slug: 'house-voice',
            ...carol,
            description: 'Everyone.',
            body: 'Notes.\n',
            ...(visibility !== undefined ? { visibility } : {}),
          }),
        ),
      ).toBe('SKILL_PUBLISH_FORBIDDEN');
    }
    await expect(stored('house-voice')).rejects.toThrow();
  });

  it('lets the same member create a skill for their own team [SKILL-R8]', async () => {
    const saveSkill = await load('saveSkillForViewer');
    const assertTeamsAssignable = vi.fn(async () => undefined);
    const { skill } = await saveSkill({
      orgSlug: 'acme',
      slug: 'red-notes',
      ...carol,
      visibility: 'team',
      teams: ['team_red'],
      description: 'Red only.',
      body: 'Notes.\n',
      assertTeamsAssignable,
    });
    expect(skill.visibility).toBe('team');
    expect(skill.owner).toBe('user_carol');
    expect(assertTeamsAssignable).toHaveBeenCalledExactlyOnceWith(['team_red']);
  });

  it('refuses widening their team skill to the organization [SKILL-R7]', async () => {
    await seedSkill(
      'acme',
      'red-notes',
      skillMd({
        name: 'red-notes',
        description: 'Red only.',
        visibility: 'team',
        teams: '[team_red]',
        owner: 'user_carol',
      }),
    );
    const before = await stored('red-notes');
    const saveSkill = await load('saveSkillForViewer');
    expect(
      await refusalCode(
        saveSkill({
          orgSlug: 'acme',
          slug: 'red-notes',
          ...carol,
          visibility: 'org',
          description: 'Red only.',
          body: 'Body.\n',
        }),
      ),
    ).toBe('SKILL_PUBLISH_FORBIDDEN');
    expect(await stored('red-notes')).toBe(before);
  });

  it('keeps an existing organization-wide skill: no edit in place, an identical save, narrowing and deleting [SKILL-R8]', async () => {
    const original = skillMd({
      name: 'house-voice',
      description: 'Everyone.',
      visibility: 'org',
      owner: 'user_carol',
    });
    await seedSkill('acme', 'house-voice', original);
    const saveSkill = await load('saveSkillForViewer');
    const readSkill = await load('readSkillForViewer');
    const current = await readSkill({
      orgSlug: 'acme',
      slug: 'house-voice',
      ...carol,
    });
    // Tightening the policy narrowed nothing: the owner still reads it, and
    // may still edit it — only not while it stays organization-wide.
    expect(current.visibility).toBe('org');
    expect(current.canEdit).toBe(true);

    expect(
      await refusalCode(
        saveSkill({
          orgSlug: 'acme',
          slug: 'house-voice',
          ...carol,
          description: 'Changed for everyone.',
          body: current.body,
        }),
      ),
    ).toBe('SKILL_PUBLISH_FORBIDDEN');
    expect(await stored('house-voice')).toBe(original);

    // Saving the document exactly as stored writes nothing, so it is no
    // publication either — a mirror re-pushing it keeps working.
    const unchanged = await saveSkill({
      orgSlug: 'acme',
      slug: 'house-voice',
      ...carol,
      description: current.description,
      body: current.body,
    });
    expect(unchanged.current.etag).toBe(current.etag);

    // Narrowing to the owner's team is open, with an edit in the same save.
    const narrowed = await saveSkill({
      orgSlug: 'acme',
      slug: 'house-voice',
      ...carol,
      visibility: 'team',
      teams: ['team_red'],
      description: 'Red only now.',
      body: current.body,
      assertTeamsAssignable: vi.fn(async () => undefined),
    });
    expect(narrowed.skill.visibility).toBe('team');
    expect(narrowed.skill.description).toBe('Red only now.');

    const deleteSkill = await load('deleteSkillForViewer');
    expect(
      await deleteSkill({ orgSlug: 'acme', slug: 'house-voice', ...carol }),
    ).toBe(true);
  });

  it('lets a publisher and an admin create, widen and edit organization-wide skills [SKILL-R7]', async () => {
    const saveSkill = await load('saveSkillForViewer');
    const created = await saveSkill({
      orgSlug: 'acme',
      slug: 'house-voice',
      ...publisher,
      description: 'Everyone.',
      body: 'Notes.\n',
    });
    expect(created.skill.visibility).toBe('org');
    await seedSkill(
      'acme',
      'red-notes',
      skillMd({
        name: 'red-notes',
        description: 'Red only.',
        visibility: 'team',
        teams: '[team_red]',
        owner: 'user_carol',
      }),
    );
    const widened = await saveSkill({
      orgSlug: 'acme',
      slug: 'red-notes',
      ...admin,
      visibility: 'org',
      description: 'Everyone now.',
      body: 'Body.\n',
    });
    expect(widened.skill.visibility).toBe('org');
    // The owner stays the member who created it.
    expect(widened.skill.owner).toBe('user_carol');
  });

  it('refuses when the door supplied no answer at all (fails closed)', async () => {
    const saveSkill = await load('saveSkillForViewer');
    expect(
      await refusalCode(
        saveSkill({
          orgSlug: 'acme',
          slug: 'house-voice',
          viewer: alice.viewer,
          description: 'Everyone.',
          body: 'Notes.\n',
        }),
      ),
    ).toBe('SKILL_PUBLISH_FORBIDDEN');
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

  it('refuses a member who may not edit the skill [SKILL-R5]', async () => {
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

  it('deletes the owner’s own skill [SKILL-R5]', async () => {
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

  // The regression under test: delete loaded the document first, so a bundle
  // whose SKILL.md fails to parse answered SKILL_MALFORMED on the one
  // operation that needs no parsed document — the failure row the library
  // shows was a dead end without filesystem access.
  it('lets an org admin, and only an org admin, delete a malformed bundle [SKILL-R16]', async () => {
    await seedSkill('acme', 'broken', '# no frontmatter\n');
    const deleteSkill = await load('deleteSkillForViewer');
    const listSkills = await load('listSkillsForViewer');

    try {
      await deleteSkill({ orgSlug: 'acme', slug: 'broken', ...bob });
      expect.unreachable('a member must not remove a bundle nobody can read');
    } catch (err) {
      expect(errorCode(err)).toBe('SKILL_FORBIDDEN');
    }
    expect((await listSkills({ orgSlug: 'acme', ...admin })).failures).toEqual([
      expect.objectContaining({ slug: 'broken' }),
    ]);

    expect(
      await deleteSkill({ orgSlug: 'acme', slug: 'broken', ...admin }),
    ).toBe(true);
    expect((await listSkills({ orgSlug: 'acme', ...admin })).failures).toEqual(
      [],
    );
  });

  it('lets an org admin clear a bundle directory that has no SKILL.md', async () => {
    const dir = path.join(configRoot, 'acme', 'skills', 'half-written');
    await mkdir(path.join(dir, 'scripts'), { recursive: true });
    await writeFile(path.join(dir, 'scripts', 'run.py'), 'print(1)\n', 'utf-8');
    const deleteSkill = await load('deleteSkillForViewer');

    try {
      await deleteSkill({ orgSlug: 'acme', slug: 'half-written', ...bob });
      expect.unreachable('a member must not remove a bundle nobody can read');
    } catch (err) {
      expect(errorCode(err)).toBe('SKILL_FORBIDDEN');
    }
    expect(
      await deleteSkill({ orgSlug: 'acme', slug: 'half-written', ...admin }),
    ).toBe(true);
    await expect(stat(dir)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

/**
 * The upload lane's normalization is the editor's rule set at a second
 * door. The regression under test: a zip that declared an `owner` was
 * honored verbatim — installing a skill in another member's name — and one
 * declaring `visibility: private` minted the retired state the editor
 * refuses.
 */
describe('normalizedBundleFiles', () => {
  function bundleOf(content: string): ParsedBundle {
    const { meta, body } = parseSkillMd(content, 'SKILL.md');
    const skillMdBytes = Buffer.from(content, 'utf-8');
    const asset = Buffer.from('print("unpack")\n', 'utf-8');
    return {
      slug: meta.name,
      meta,
      body,
      files: [
        { relPath: 'SKILL.md', content: skillMdBytes },
        { relPath: 'scripts/unpack.py', content: asset },
      ],
      totalBytes: skillMdBytes.length + asset.length,
    };
  }
  function existingOf(content: string): OrgSkill {
    const { meta, body } = parseSkillMd(content, 'SKILL.md');
    return {
      slug: meta.name,
      path: `skills/${meta.name}/SKILL.md`,
      meta,
      body,
      etag: '"0000"',
      updatedAt: 1_700_000_000_000,
    };
  }
  function writtenMeta(files: Array<{ path: string; content: Buffer }>) {
    const doc = files.find((file) => file.path === 'SKILL.md');
    if (doc === undefined) throw new Error('no SKILL.md written');
    return parseSkillMd(doc.content.toString('utf-8'), 'SKILL.md').meta;
  }

  it('attributes a new bundle to its uploader, whatever owner the zip declares [SKILL-R6]', () => {
    const files = normalizedBundleFiles(
      bundleOf(
        skillMd({
          name: 'house-voice',
          description: 'Ours.',
          owner: 'user_someone_else',
        }),
      ),
      alice.viewer,
      null,
    );

    expect(files.map((file) => file.path)).toEqual([
      'SKILL.md',
      'scripts/unpack.py',
    ]);
    expect(writtenMeta(files)).toMatchObject({
      owner: 'user_alice',
      visibility: 'org',
    });
  });

  it('adopts the uploader as owner of an unmarked bundle', () => {
    const files = normalizedBundleFiles(
      bundleOf(skillMd({ name: 'house-voice', description: 'Ours.' })),
      bob.viewer,
      null,
    );
    expect(writtenMeta(files).owner).toBe('user_bob');
  });

  it('refuses to mint a private skill, exactly like the editor [SKILL-R3]', () => {
    expect(() =>
      normalizedBundleFiles(
        bundleOf(
          skillMd({
            name: 'alice-drafts',
            description: 'Mine alone.',
            visibility: 'private',
            owner: 'user_alice',
          }),
        ),
        alice.viewer,
        null,
      ),
    ).toThrow(/SKILL_PRIVATE_RETIRED/);
  });

  it('keeps a pre-existing private bundle private when its owner re-uploads it', () => {
    const files = normalizedBundleFiles(
      bundleOf(
        skillMd({
          name: 'alice-drafts',
          description: 'Mine alone, v2.',
          visibility: 'private',
          owner: 'user_alice',
        }),
      ),
      alice.viewer,
      existingOf(
        skillMd({
          name: 'alice-drafts',
          description: 'Mine alone.',
          visibility: 'private',
          owner: 'user_alice',
        }),
      ),
    );
    expect(writtenMeta(files)).toMatchObject({
      visibility: 'private',
      owner: 'user_alice',
    });
  });

  it('keeps the current owner on a replacement, whatever the zip declares [SKILL-R6]', () => {
    const files = normalizedBundleFiles(
      bundleOf(
        skillMd({
          name: 'house-voice',
          description: 'Replaced.',
          owner: 'user_someone_else',
        }),
      ),
      admin.viewer,
      existingOf(
        skillMd({
          name: 'house-voice',
          description: 'Original.',
          visibility: 'org',
          owner: 'user_alice',
        }),
      ),
    );
    expect(writtenMeta(files).owner).toBe('user_alice');
  });

  it('attributes the replacement of an ownerless bundle to its uploader', () => {
    const files = normalizedBundleFiles(
      bundleOf(skillMd({ name: 'house-voice', description: 'Replaced.' })),
      admin.viewer,
      existingOf(skillMd({ name: 'house-voice', description: 'Original.' })),
    );
    expect(writtenMeta(files).owner).toBe('user_admin');
  });

  it('leaves SKILL.md byte-for-byte when the zip already says what the readers conclude', () => {
    const content = skillMd({
      name: 'house-voice',
      description: 'Ours.',
      owner: 'user_alice',
    });
    const files = normalizedBundleFiles(bundleOf(content), alice.viewer, null);
    expect(files[0]?.content.toString('utf-8')).toBe(content);
  });
});

describe('prepareBundleWrite', () => {
  function bundleOf(content: string): ParsedBundle {
    const { meta, body } = parseSkillMd(content, 'SKILL.md');
    const bytes = Buffer.from(content, 'utf-8');
    return {
      slug: meta.name,
      meta,
      body,
      files: [{ relPath: 'SKILL.md', content: bytes }],
      totalBytes: bytes.length,
    };
  }
  function existingOf(content: string): OrgSkill {
    const { meta, body } = parseSkillMd(content, 'SKILL.md');
    return {
      slug: meta.name,
      path: `skills/${meta.name}/SKILL.md`,
      meta,
      body,
      etag: '"0000"',
      updatedAt: 1_700_000_000_000,
    };
  }
  const teamSkill = (teams: string[]) =>
    skillMd({
      name: 'house-voice',
      description: 'Ours.',
      visibility: 'team',
      teams: `[${teams.join(', ')}]`,
    });

  it('checks the teams of a new team skill before handing back its files', async () => {
    const assertTeamsAssignable = vi.fn(async () => undefined);
    const files = await prepareBundleWrite({
      parsed: bundleOf(teamSkill(['t-fin', 't-ops'])),
      uploader: alice.viewer,
      mayPublishOrgWide: true,
      existing: null,
      assertTeamsAssignable,
    });
    expect(assertTeamsAssignable).toHaveBeenCalledExactlyOnceWith([
      't-fin',
      't-ops',
    ]);
    expect(files.map((file) => file.path)).toEqual(['SKILL.md']);
  });

  it('refuses with the door’s refusal when a team is not assignable [SKILL-R9]', async () => {
    const refusal = new Error('TEAM_ACCESS_DENIED');
    await expect(
      prepareBundleWrite({
        parsed: bundleOf(teamSkill(['t-foreign'])),
        uploader: alice.viewer,
        mayPublishOrgWide: true,
        existing: null,
        assertTeamsAssignable: async () => {
          throw refusal;
        },
      }),
    ).rejects.toBe(refusal);
  });

  it('checks and stores the editor’s normalized audience, including an already correct owner', async () => {
    const parsed = bundleOf(
      skillMd({
        name: 'house-voice',
        description: 'Ours.',
        visibility: 'team',
        owner: alice.viewer.userId,
        teams: '[" t-fin ", t-fin, " "]',
      }),
    );
    const assertTeamsAssignable = vi.fn(async () => undefined);
    const files = await prepareBundleWrite({
      parsed,
      uploader: alice.viewer,
      mayPublishOrgWide: true,
      existing: null,
      assertTeamsAssignable,
    });
    expect(assertTeamsAssignable).toHaveBeenCalledExactlyOnceWith(['t-fin']);
    expect(
      parseSkillMd(files[0]!.content.toString('utf8'), 'SKILL.md').meta.teams,
    ).toEqual(['t-fin']);
  });

  it('refuses a blank-only audience instead of writing an invisible team skill [SKILL-R9]', async () => {
    const assertTeamsAssignable = vi.fn(async () => undefined);
    await expect(
      prepareBundleWrite({
        parsed: bundleOf(teamSkill(['" "'])),
        uploader: alice.viewer,
        mayPublishOrgWide: true,
        existing: null,
        assertTeamsAssignable,
      }),
    ).rejects.toMatchObject({ data: { code: 'INVALID_SKILL' } });
    expect(assertTeamsAssignable).not.toHaveBeenCalled();
  });

  it('rechecks an old padded audience before normalizing it to visible team IDs', async () => {
    const assertTeamsAssignable = vi.fn(async () => undefined);
    await prepareBundleWrite({
      parsed: bundleOf(teamSkill(['" t-fin "'])),
      uploader: alice.viewer,
      mayPublishOrgWide: true,
      existing: existingOf(teamSkill(['" t-fin "'])),
      assertTeamsAssignable,
    });
    expect(assertTeamsAssignable).toHaveBeenCalledExactlyOnceWith(['t-fin']);
  });

  it('does not re-check an unchanged team list, and checks a changed one', async () => {
    const existing = existingOf(teamSkill(['t-fin', 't-ops']));
    const unchanged = vi.fn(async () => undefined);
    await prepareBundleWrite({
      parsed: bundleOf(teamSkill(['t-ops', 't-fin'])),
      uploader: alice.viewer,
      mayPublishOrgWide: true,
      existing,
      assertTeamsAssignable: unchanged,
    });
    expect(unchanged).not.toHaveBeenCalled();

    const changed = vi.fn(async () => undefined);
    await prepareBundleWrite({
      parsed: bundleOf(teamSkill(['t-fin', 't-hr'])),
      uploader: alice.viewer,
      mayPublishOrgWide: true,
      existing,
      assertTeamsAssignable: changed,
    });
    expect(changed).toHaveBeenCalledExactlyOnceWith(['t-fin', 't-hr']);
  });

  it('checks no teams for an organization skill', async () => {
    const assertTeamsAssignable = vi.fn(async () => undefined);
    await prepareBundleWrite({
      parsed: bundleOf(skillMd({ name: 'house-voice', description: 'Ours.' })),
      uploader: alice.viewer,
      mayPublishOrgWide: true,
      existing: null,
      assertTeamsAssignable,
    });
    expect(assertTeamsAssignable).not.toHaveBeenCalled();
  });

  it('refuses an organization-wide bundle the uploader may not publish, an unmarked one included [SKILL-R7]', async () => {
    for (const content of [
      skillMd({ name: 'house-voice', description: 'Ours.' }),
      skillMd({ name: 'house-voice', description: 'Ours.', visibility: 'org' }),
    ]) {
      await expect(
        prepareBundleWrite({
          parsed: bundleOf(content),
          uploader: alice.viewer,
          mayPublishOrgWide: false,
          existing: null,
          assertTeamsAssignable: vi.fn(async () => undefined),
        }),
      ).rejects.toMatchObject({
        data: {
          code: 'SKILL_PUBLISH_FORBIDDEN',
          data: { slug: 'house-voice' },
        },
      });
    }
    // Replacing an organization skill with the same bytes is still a write
    // of every file, so it needs the right as well.
    const orgSkill = skillMd({
      name: 'house-voice',
      description: 'Ours.',
      visibility: 'org',
      owner: alice.viewer.userId,
    });
    await expect(
      prepareBundleWrite({
        parsed: bundleOf(orgSkill),
        uploader: alice.viewer,
        mayPublishOrgWide: false,
        existing: existingOf(orgSkill),
        assertTeamsAssignable: vi.fn(async () => undefined),
      }),
    ).rejects.toMatchObject({ data: { code: 'SKILL_PUBLISH_FORBIDDEN' } });
  });

  it('lets a non-publisher upload a team bundle for their own teams [SKILL-R8]', async () => {
    const assertTeamsAssignable = vi.fn(async () => undefined);
    const files = await prepareBundleWrite({
      parsed: bundleOf(teamSkill(['team_red'])),
      uploader: alice.viewer,
      mayPublishOrgWide: false,
      existing: existingOf(
        skillMd({
          name: 'house-voice',
          description: 'Ours.',
          visibility: 'org',
        }),
      ),
      assertTeamsAssignable,
    });
    expect(assertTeamsAssignable).toHaveBeenCalledExactlyOnceWith(['team_red']);
    expect(files.map((file) => file.path)).toEqual(['SKILL.md']);
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

  it('reads a private bundle as absent for everyone but its owner [SKILL-R2]', async () => {
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

  it('resolves a team skill by team overlap, owner, or admin seat [SKILL-R1]', async () => {
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

  it('resolves a team skill for a project by ITS teams, never a member’s [SKILL-R1]', async () => {
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

    const { skill: created } = await saveSkill({
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

    const { skill: reshared } = await saveSkill({
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

  it('refuses a team skill that would end up with no teams [SKILL-R9]', async () => {
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
    expect(asset.kind).toBe('asset');
    expect(asset.path).toBe('scripts/fill.py');
    expect(asset.content.toString('utf-8')).toBe('print(1)\n');

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
      ).toEqual({ kind: 'no-file' });
    }
    expect(
      await readSkillAsset({
        orgSlug: 'acme',
        slug: 'no-such-skill',
        path: 'SKILL.md',
        ...bob,
      }),
    ).toEqual({ kind: 'no-skill' });
  });

  it('answers a planted symlink as the bundle’s own refusal, naming the entry org-relative [SKILL-R15]', async () => {
    await seedSkill(
      'acme',
      'pdf-notes',
      skillMd({ name: 'pdf-notes', description: 'Doc.', visibility: 'org' }),
    );
    const bundleDir = path.join(configRoot, 'acme', 'skills', 'pdf-notes');
    await symlink('/etc/hostname', path.join(bundleDir, 'link.md'));
    const readSkillAsset = await load('readSkillAssetForViewer');
    const readSkill = await load('readSkillForViewer');

    for (const read of [
      () =>
        readSkillAsset({
          orgSlug: 'acme',
          slug: 'pdf-notes',
          path: 'link.md',
          ...bob,
        }),
      // The file list walks the bundle and meets the link too.
      () => readSkill({ orgSlug: 'acme', slug: 'pdf-notes', ...bob }),
    ]) {
      try {
        await read();
        expect.unreachable('a symlink in the bundle must be refused');
      } catch (err) {
        expect(errorCode(err)).toBe('SKILL_MALFORMED');
        expect(errorMessage(err)).toBe(
          'skills/pdf-notes/link.md could not be read: the skill bundle contains a symlink',
        );
        expect(errorMessage(err)).not.toContain(configRoot);
      }
    }
  });

  it('hides assets of a skill the viewer may not see [SKILL-R2]', async () => {
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
    ).toEqual({ kind: 'no-skill' });
  });
});

describe('who created a skill, as every view reads it', () => {
  const viewer = {
    kind: 'user' as const,
    userId: 'user-ada',
    teamIds: [],
    isOrgAdmin: false,
  };

  it('reads a member skill, a skill with no owner and a release install apart', async () => {
    await seedSkill(
      'acme',
      'by-member',
      skillMd({ name: 'by-member', description: 'd', owner: 'user-ada' }),
    );
    await seedSkill(
      'acme',
      'docx',
      skillMd({ name: 'docx', description: 'Word documents' }),
    );
    await seedSkill(
      'acme',
      'released',
      [
        '---',
        'name: released',
        'description: From the release',
        'owner: user-operator',
        'metadata:',
        '  tale-release:',
        '    logicalSlug: released',
        '    sourceCommit: 0123456789abcdef0123456789abcdef01234567',
        '---',
        '',
        'Body.',
        '',
      ].join('\n'),
    );
    const list = await load('listSkillsForViewer');
    const { skills } = await list({ orgSlug: 'acme', viewer });
    const origins = Object.fromEntries(
      skills.map((skill: { slug: string; origin: string }) => [
        skill.slug,
        skill.origin,
      ]),
    );
    expect(origins).toEqual({
      'by-member': 'member',
      docx: 'builtin',
      released: 'release',
    });
  });

  it('answers a save with the revision before and after, for the audit record', async () => {
    const save = await load('saveSkillForViewer');
    const created = await save({
      orgSlug: 'acme',
      slug: 'fresh',
      viewer,
      mayPublishOrgWide: true,
      description: 'First',
      body: 'One',
    });
    expect(created.previous).toBeNull();
    expect(created.current).toMatchObject({
      meta: { owner: 'user-ada', description: 'First' },
      body: 'One\n',
      etag: created.skill.etag,
    });

    const updated = await save({
      orgSlug: 'acme',
      slug: 'fresh',
      viewer,
      mayPublishOrgWide: true,
      description: 'Second',
      body: 'One',
    });
    expect(updated.previous).toMatchObject({
      meta: { description: 'First' },
      etag: created.skill.etag,
    });
    expect(updated.current.etag).toBe(updated.skill.etag);
    expect(updated.current.etag).not.toBe(created.skill.etag);

    const unchanged = await save({
      orgSlug: 'acme',
      slug: 'fresh',
      viewer,
      mayPublishOrgWide: true,
      description: 'Second',
      body: 'One',
    });
    expect(unchanged.previous.etag).toBe(unchanged.current.etag);
  });
});

describe('describeBundleWrite', () => {
  const document = skillMd({
    name: 'bundle',
    description: 'd',
    owner: 'user-ada',
  });
  const files = (asset: string) => [
    { path: 'SKILL.md', content: Buffer.from(document) },
    { path: 'scripts/run.py', content: Buffer.from(asset) },
  ];
  const stored = (asset: string) =>
    files(asset).map((file) => ({
      path: file.path,
      contentBase64: file.content.toString('base64'),
    }));

  it('tags the written document the way the listing will', async () => {
    await seedSkill('acme', 'bundle', document);
    const read = await load('readSkillForViewer');
    const live = await read({
      orgSlug: 'acme',
      slug: 'bundle',
      viewer: { kind: 'org' },
    });
    const change = describeBundleWrite({
      slug: 'bundle',
      existing: null,
      stored: null,
      files: files('print(1)'),
    });
    expect(change.previous).toBeNull();
    expect(change.current.etag).toBe(live.etag);
    expect(change.current.meta.owner).toBe('user-ada');
  });

  it('tells a changed asset from an identical bundle', () => {
    const same = describeBundleWrite({
      slug: 'bundle',
      existing: null,
      stored: stored('print(1)'),
      files: files('print(1)'),
    });
    expect(same.filesChanged).toBe(false);
    const changed = describeBundleWrite({
      slug: 'bundle',
      existing: null,
      stored: stored('print(1)'),
      files: files('print(2)'),
    });
    expect(changed.filesChanged).toBe(true);
    const removed = describeBundleWrite({
      slug: 'bundle',
      existing: null,
      stored: stored('print(1)'),
      files: files('print(1)').slice(0, 1),
    });
    expect(removed.filesChanged).toBe(true);
  });
});
