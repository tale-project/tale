import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The Convex codegen wrapper is unavailable in a unit test — passthrough the
// `action({...})` config so we can call its `handler` directly.
vi.mock('../_generated/server', () => ({
  action: (config: unknown) => config,
  internalAction: (config: unknown) => config,
}));

// `internal.*` function references are only used as `ctx.runMutation` tokens —
// plain string markers keep the assertions readable.
vi.mock('../_generated/api', () => ({
  internal: {
    skills: {
      audit_mutations: {
        logSkillAuditEvent: 'skills/audit_mutations:logSkillAuditEvent',
      },
      upload_mutations: {
        verifySkillUploadIntent: 'skills/upload_mutations:verify',
        deleteSkillUploadIntent: 'skills/upload_mutations:delete',
        claimSkillUploadSlot: 'skills/upload_mutations:claim',
        releaseSkillUploadSlot: 'skills/upload_mutations:release',
      },
    },
  },
}));

const mockInvalidateSkillContextCache = vi.fn();
vi.mock('../lib/agent_chat/skill_context_cache', () => ({
  invalidateSkillContextCache: (...args: unknown[]) =>
    mockInvalidateSkillContextCache(...args),
}));

// The create/list actions are developer-gated; the gate itself is covered by
// the auth helper's own tests — stub it and assert the actions consult it.
const mockRequireOrgAdminOrDeveloper = vi.fn();
vi.mock('../lib/auth/require_org_admin_or_developer', () => ({
  requireOrgAdminOrDeveloper: (...args: unknown[]) =>
    mockRequireOrgAdminOrDeveloper(...args),
}));

const { createSkill, listCatalogSkills } = await import('./file_actions');
const { parseSkillMd } = await import('../../lib/shared/schemas/skills');

type ActionConfig = {
  handler: (ctx: never, args: never) => Promise<unknown>;
};
const createHandler = (createSkill as unknown as ActionConfig).handler;
const listCatalogHandler = (listCatalogSkills as unknown as ActionConfig)
  .handler;

const ORG_SLUG = 'test-org';
const CONFIG_ENV = 'TALE_CONFIG_DIR';
const BUILTIN_ENV = 'TALE_CONFIG_BUILTIN_DIR';

let configRoot: string;
let catalogRoot: string;
let prevConfigDir: string | undefined;
let prevBuiltinDir: string | undefined;

const runMutation = vi.fn().mockResolvedValue(null);
const ctx = { runMutation } as never;

function orgSkillDir(slug: string): string {
  return path.join(configRoot, ORG_SLUG, 'skills', slug);
}

async function writeCatalogSkill(
  slug: string,
  skillMdContent: string,
  assets: Record<string, string> = {},
): Promise<void> {
  const dir = path.join(catalogRoot, 'skills', slug);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'SKILL.md'), skillMdContent, 'utf8');
  for (const [rel, content] of Object.entries(assets)) {
    const abs = path.join(dir, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf8');
  }
}

function skillMd(name: string, body = 'Do the thing.\n'): string {
  return `---\nname: ${name}\ndescription: Test skill ${name}\n---\n\n${body}`;
}

beforeEach(async () => {
  // realpath: macOS `tmpdir()` is a symlink (`/var` → `/private/var`); the
  // asset-path guard realpaths existing dirs, so the roots must be canonical.
  configRoot = await realpath(
    await mkdtemp(path.join(tmpdir(), 'skills-config-')),
  );
  catalogRoot = await realpath(
    await mkdtemp(path.join(tmpdir(), 'skills-catalog-')),
  );
  prevConfigDir = process.env[CONFIG_ENV];
  prevBuiltinDir = process.env[BUILTIN_ENV];
  process.env[CONFIG_ENV] = configRoot;
  process.env[BUILTIN_ENV] = catalogRoot;
  runMutation.mockClear();
  mockInvalidateSkillContextCache.mockClear();
  mockRequireOrgAdminOrDeveloper.mockReset();
  mockRequireOrgAdminOrDeveloper.mockResolvedValue({
    orgId: 'org-123',
    orgSlug: ORG_SLUG,
    userId: 'user-1',
    email: 'a@b.com',
    member: { _id: 'm-1', role: 'admin' },
  });
});

afterEach(async () => {
  if (prevConfigDir === undefined) delete process.env[CONFIG_ENV];
  else process.env[CONFIG_ENV] = prevConfigDir;
  if (prevBuiltinDir === undefined) delete process.env[BUILTIN_ENV];
  else process.env[BUILTIN_ENV] = prevBuiltinDir;
  await rm(configRoot, { recursive: true, force: true });
  await rm(catalogRoot, { recursive: true, force: true });
});

describe('createSkill — blank', () => {
  it('writes a minimal valid SKILL.md whose frontmatter name matches the slug', async () => {
    const result = await createHandler(ctx, {
      organizationId: 'org_test',
      slug: 'my-skill',
    } as never);

    expect(result).toEqual({ slug: 'my-skill' });
    const content = await readFile(
      path.join(orgSkillDir('my-skill'), 'SKILL.md'),
      'utf8',
    );
    const { meta, body } = parseSkillMd(content);
    expect(meta.name).toBe('my-skill');
    expect(meta.description.length).toBeGreaterThan(0);
    expect(body.length).toBeGreaterThan(0);
    // Audit trail + runtime-cache invalidation ride the create.
    expect(runMutation).toHaveBeenCalledWith(
      'skills/audit_mutations:logSkillAuditEvent',
      expect.objectContaining({
        action: 'create_skill',
        resourceId: 'my-skill',
      }),
    );
    expect(mockInvalidateSkillContextCache).toHaveBeenCalledWith(ORG_SLUG);
  });

  it('rejects an invalid slug before touching auth or disk', async () => {
    await expect(
      createHandler(ctx, {
        organizationId: 'org_test',
        slug: 'Bad Slug',
      } as never),
    ).rejects.toMatchObject({ data: { code: 'INVALID_SLUG' } });
    expect(mockRequireOrgAdminOrDeveloper).not.toHaveBeenCalled();
  });
});

describe('createSkill — from template', () => {
  it('copies the builtin bundle and rewrites the frontmatter name to the new slug', async () => {
    await writeCatalogSkill('browse-web', skillMd('browse-web', 'Browse.\n'), {
      'scripts/run.py': 'print("hi")\n',
      'references/notes.md': 'notes\n',
    });

    const result = await createHandler(ctx, {
      organizationId: 'org_test',
      slug: 'my-browse',
      templateSlug: 'browse-web',
    } as never);

    expect(result).toEqual({ slug: 'my-browse' });
    const { meta, body } = parseSkillMd(
      await readFile(path.join(orgSkillDir('my-browse'), 'SKILL.md'), 'utf8'),
    );
    // name == slug == directory (the upload path's invariant).
    expect(meta.name).toBe('my-browse');
    expect(meta.description).toBe('Test skill browse-web');
    expect(body).toContain('Browse.');
    await expect(
      readFile(path.join(orgSkillDir('my-browse'), 'scripts/run.py'), 'utf8'),
    ).resolves.toBe('print("hi")\n');
    await expect(
      readFile(
        path.join(orgSkillDir('my-browse'), 'references/notes.md'),
        'utf8',
      ),
    ).resolves.toBe('notes\n');
  });

  it('rejects a template slug that is not in the builtin catalog', async () => {
    await expect(
      createHandler(ctx, {
        organizationId: 'org_test',
        slug: 'my-skill',
        templateSlug: 'does-not-exist',
      } as never),
    ).rejects.toMatchObject({ data: { code: 'NOT_FOUND' } });
    // Nothing landed on disk.
    await expect(stat(orgSkillDir('my-skill'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});

describe('createSkill — collisions and auth', () => {
  it('rejects an existing slug (even a broken bundle directory)', async () => {
    // A bare directory with no readable SKILL.md still blocks the create.
    await mkdir(orgSkillDir('taken'), { recursive: true });

    await expect(
      createHandler(ctx, {
        organizationId: 'org_test',
        slug: 'taken',
      } as never),
    ).rejects.toMatchObject({ data: { code: 'SKILL_EXISTS' } });
  });

  it('refuses when the developer gate rejects, writing nothing', async () => {
    mockRequireOrgAdminOrDeveloper.mockRejectedValue(
      new ConvexError({ code: 'FORBIDDEN_DEVELOPER_SETTINGS' }),
    );

    await expect(
      createHandler(ctx, {
        organizationId: 'org_test',
        slug: 'my-skill',
      } as never),
    ).rejects.toMatchObject({ data: { code: 'FORBIDDEN_DEVELOPER_SETTINGS' } });
    await expect(stat(orgSkillDir('my-skill'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});

describe('listCatalogSkills', () => {
  it('lists builtin skills sorted by slug, skipping unparseable ones', async () => {
    await writeCatalogSkill('zeta', skillMd('zeta'));
    await writeCatalogSkill('alpha', skillMd('alpha'));
    await writeCatalogSkill('broken', 'no frontmatter at all');

    const result = await listCatalogHandler(ctx, {
      organizationId: 'org_test',
    } as never);

    expect(result).toEqual([
      { slug: 'alpha', name: 'alpha', description: 'Test skill alpha' },
      { slug: 'zeta', name: 'zeta', description: 'Test skill zeta' },
    ]);
  });

  it('is developer-gated like the org skills surface', async () => {
    mockRequireOrgAdminOrDeveloper.mockRejectedValue(
      new ConvexError({ code: 'FORBIDDEN_DEVELOPER_SETTINGS' }),
    );
    await expect(
      listCatalogHandler(ctx, { organizationId: 'org_test' } as never),
    ).rejects.toMatchObject({ data: { code: 'FORBIDDEN_DEVELOPER_SETTINGS' } });
  });
});
