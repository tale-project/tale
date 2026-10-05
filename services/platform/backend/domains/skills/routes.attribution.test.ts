// @vitest-environment node

/**
 * The app's skill door names who created and who last edited each skill,
 * and records every write in the audit log as the signed-in member — inside
 * the transaction that holds the skill's writer lock.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Context } from 'hono';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../../lib/shared/errors/app-error';
import type { OrgEnv } from '../../auth/org.ts';

const mocks = vi.hoisted(() => ({
  listSkillsForViewer: vi.fn(),
  readSkillForViewer: vi.fn(),
  saveSkillForViewer: vi.fn(),
  withSkillAttribution: vi.fn(),
  withOneSkillAttribution: vi.fn(),
  auditSkillWrite: vi.fn(),
  uploadSkillBundlePg: vi.fn(),
  resolveSkillPublishing: vi.fn(),
  maySkillPublishOrgWide: vi.fn(),
  auditIfPublishRefused: vi.fn(),
}));

vi.mock('../../core/skills/file_actions.ts', () => ({
  deleteSkillForViewer: vi.fn(),
  listSkillsForViewer: mocks.listSkillsForViewer,
  readSkillAssetForViewer: vi.fn(),
  readSkillForViewer: mocks.readSkillForViewer,
  saveSkillForViewer: mocks.saveSkillForViewer,
}));
vi.mock('./attribution.ts', () => ({
  withSkillAttribution: mocks.withSkillAttribution,
  withOneSkillAttribution: mocks.withOneSkillAttribution,
}));
vi.mock('./audit.ts', () => ({ auditSkillWrite: mocks.auditSkillWrite }));
vi.mock('./upload.ts', () => ({
  uploadSkillBundlePg: mocks.uploadSkillBundlePg,
}));
vi.mock('./publish.ts', () => ({
  resolveSkillPublishing: mocks.resolveSkillPublishing,
  maySkillPublishOrgWide: mocks.maySkillPublishOrgWide,
  auditIfPublishRefused: mocks.auditIfPublishRefused,
}));
vi.mock('../../auth/membership.ts', () => ({
  getUserTeamIds: vi.fn(async () => ['team-1']),
}));
vi.mock('../../lib/org-config.ts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../lib/org-config.ts')>();
  return { ...actual, resolveOrgSlug: vi.fn(async () => 'acme') };
});
vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: 'u1', email: 'ada@example.test' },
      } as never);
      await next();
    },
}));
vi.mock('../../auth/org.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/org.ts')>();
  return {
    ...actual,
    requireOrgMember:
      () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
        c.set('orgId', 'o1');
        c.set('orgMember', { role: 'member' } as never);
        await next();
      },
  };
});

import { createSkillRoutes } from './routes.ts';

/** A `sql` whose transactions record their order, so a test can tell what
 * ran inside the writer lock. */
function fakeSql(events: string[]): Sql {
  const tx = (strings: TemplateStringsArray) => {
    if (strings.join('?').includes('pg_advisory_xact_lock')) {
      events.push('lock');
    }
    return Promise.resolve([]);
  };
  const begin = async (work: (tx: unknown) => Promise<unknown>) => {
    events.push('begin');
    try {
      return await work(tx);
    } finally {
      events.push('commit');
    }
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { begin } as unknown as Sql;
}

const summary = {
  slug: 'house-voice',
  description: 'How we write',
  visibility: 'org',
  owner: 'u1',
  origin: 'member',
  canEdit: true,
  etag: '"t2"',
  updatedAt: 1,
};
const revision = (etag: string) => ({
  meta: { name: 'house-voice', description: 'd', visibility: 'org', extra: {} },
  body: 'x\n',
  etag,
});

function routes(events: string[] = []) {
  return createSkillRoutes({ sql: fakeSql(events), auth: {} as never });
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.resolveSkillPublishing.mockResolvedValue({
    mode: 'everyone',
    allowed: true,
  });
  mocks.maySkillPublishOrgWide.mockResolvedValue(true);
  mocks.withSkillAttribution.mockImplementation(
    async (_sql: unknown, _org: string, skills: object[]) =>
      skills.map((skill) => ({ ...skill, ownerName: 'Ada Lovelace' })),
  );
  mocks.withOneSkillAttribution.mockImplementation(
    async (_sql: unknown, _org: string, skill: object) => ({
      ...skill,
      ownerName: 'Ada Lovelace',
    }),
  );
});

describe('the app skill door', () => {
  it('lists skills with their creator resolved for the organization', async () => {
    mocks.listSkillsForViewer.mockResolvedValue({
      skills: [summary],
      failures: [],
    });
    const res = await routes().request('/?orgId=o1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      skills: [{ ...summary, ownerName: 'Ada Lovelace' }],
      failures: [],
      publishing: { mode: 'everyone', allowed: true },
    });
    expect(mocks.withSkillAttribution).toHaveBeenCalledWith(
      expect.anything(),
      'o1',
      [summary],
    );
  });

  it('reads one skill with its creator resolved', async () => {
    mocks.readSkillForViewer.mockResolvedValue({ ...summary, body: 'x\n' });
    const res = await routes().request('/house-voice?orgId=o1');
    expect(await res.json()).toEqual({
      skill: { ...summary, body: 'x\n', ownerName: 'Ada Lovelace' },
    });
  });

  it('audits a save as the member, inside the writer lock, through the app door', async () => {
    const events: string[] = [];
    mocks.saveSkillForViewer.mockImplementation(async () => {
      events.push('save');
      return {
        skill: { ...summary, body: 'x\n', files: [] },
        created: false,
        previous: revision('"t1"'),
        current: revision('"t2"'),
      };
    });
    mocks.auditSkillWrite.mockImplementation(async () => {
      events.push('audit');
    });

    const res = await routes(events).request('/house-voice?orgId=o1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'How we write', body: 'x' }),
    });

    expect(res.status).toBe(200);
    expect(events).toEqual(['begin', 'lock', 'save', 'audit', 'commit']);
    expect(mocks.auditSkillWrite).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'o1',
      slug: 'house-voice',
      actor: { id: 'u1', email: 'ada@example.test', role: 'member' },
      via: 'app',
      previous: revision('"t1"'),
      current: revision('"t2"'),
    });
    expect(await res.json()).toMatchObject({
      skill: { ownerName: 'Ada Lovelace' },
    });
  });

  it('hands the member to the upload lane for its audit row', async () => {
    mocks.uploadSkillBundlePg.mockResolvedValue({
      ok: true,
      slug: 'house-voice',
    });
    const res = await routes().request('/upload?orgId=o1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ storageId: 's3:acme/skill_bundle/x' }),
    });
    expect(res.status).toBe(200);
    expect(mocks.uploadSkillBundlePg.mock.calls[0]?.[1]).toMatchObject({
      organizationId: 'o1',
      actor: { id: 'u1', email: 'ada@example.test', role: 'member' },
      mayPublishOrgWide: true,
    });
  });
});

describe('the app skill door under a reserved organization-wide audience', () => {
  beforeEach(() => {
    mocks.resolveSkillPublishing.mockResolvedValue({
      mode: 'admins',
      allowed: false,
    });
    mocks.maySkillPublishOrgWide.mockResolvedValue(false);
  });

  it('tells the library the member may not publish, and under which mode', async () => {
    mocks.listSkillsForViewer.mockResolvedValue({ skills: [], failures: [] });
    const res = await routes().request('/?orgId=o1');
    expect(await res.json()).toMatchObject({
      publishing: { mode: 'admins', allowed: false },
    });
    expect(mocks.resolveSkillPublishing).toHaveBeenCalledWith(
      expect.anything(),
      { organizationId: 'o1', userId: 'u1', role: 'member' },
    );
  });

  it('passes a create-only precondition through the locked save', async () => {
    mocks.saveSkillForViewer.mockResolvedValue({
      skill: { ...summary, body: '' },
      previous: null,
      current: revision('t1'),
    });
    const res = await routes().request('/house-voice?orgId=o1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'if-none-match': '*' },
      body: JSON.stringify({ description: 'd', body: '' }),
    });
    expect(res.status).toBe(200);
    expect(mocks.saveSkillForViewer.mock.calls.at(-1)?.[0]).toMatchObject({
      slug: 'house-voice',
      precondition: { ifNoneMatch: { kind: 'any' } },
    });
  });

  it('hands the answer to the save, and answers and audits its refusal', async () => {
    const refusal = new AppError({
      code: 'SKILL_PUBLISH_FORBIDDEN',
      message: 'reserved',
      data: { slug: 'house-voice' },
    });
    mocks.saveSkillForViewer.mockRejectedValue(refusal);
    const res = await routes().request('/house-voice?orgId=o1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'How we write', body: 'x' }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'SKILL_PUBLISH_FORBIDDEN',
      message: 'reserved',
    });
    expect(mocks.saveSkillForViewer.mock.calls[0]?.[0]).toMatchObject({
      mayPublishOrgWide: false,
    });
    expect(mocks.auditSkillWrite).not.toHaveBeenCalled();
    expect(mocks.auditIfPublishRefused).toHaveBeenCalledWith(
      expect.anything(),
      refusal,
      {
        organizationId: 'o1',
        actor: { id: 'u1', email: 'ada@example.test', role: 'member' },
        via: 'app',
      },
    );
  });

  it('hands the answer to the upload lane, and audits its refusal as an upload', async () => {
    const refusal = new AppError({
      code: 'SKILL_PUBLISH_FORBIDDEN',
      message: 'reserved',
      data: { slug: 'house-voice' },
    });
    mocks.uploadSkillBundlePg.mockRejectedValue(refusal);
    const res = await routes().request('/upload?orgId=o1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ storageId: 's3:acme/skill_bundle/x' }),
    });
    expect(res.status).toBe(403);
    expect(mocks.uploadSkillBundlePg.mock.calls[0]?.[1]).toMatchObject({
      mayPublishOrgWide: false,
    });
    expect(mocks.auditIfPublishRefused).toHaveBeenCalledWith(
      expect.anything(),
      refusal,
      expect.objectContaining({ via: 'upload' }),
    );
  });
});

describe('the app skill door with the native file store', () => {
  it('preserves an occupied slug on stale creation, creates an absent slug, and allows ordinary edits', async () => {
    const configRoot = await mkdtemp(path.join(tmpdir(), 'tale-skill-create-'));
    const savedConfigDir = process.env.TALE_CONFIG_DIR;
    process.env.TALE_CONFIG_DIR = configRoot;
    try {
      const actual = await vi.importActual<
        typeof import('../../core/skills/file_actions.ts')
      >('../../core/skills/file_actions.ts');
      const events: string[] = [];
      const viewer = {
        kind: 'user' as const,
        userId: 'u1',
        teamIds: ['team-1'],
        isOrgAdmin: false,
      };
      await actual.saveSkillForViewer({
        orgSlug: 'acme',
        slug: 'house-voice',
        viewer,
        mayPublishOrgWide: true,
        description: 'Existing description.',
        body: 'Existing instructions to preserve.\n',
        visibility: 'team',
        teams: ['team-1'],
        labels: ['preserve'],
      });
      const skillPath = path.join(
        configRoot,
        'acme',
        'skills',
        'house-voice',
        'SKILL.md',
      );
      const before = await readFile(skillPath);
      mocks.saveSkillForViewer.mockImplementation(
        async (args: Parameters<typeof actual.saveSkillForViewer>[0]) => {
          events.push('save');
          return actual.saveSkillForViewer(args);
        },
      );
      mocks.auditSkillWrite.mockImplementation(async () => {
        events.push('audit');
      });
      const app = routes(events);
      const refused = await app.request('/house-voice?orgId=o1', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'if-none-match': '*' },
        body: JSON.stringify({
          description: 'Stale create.',
          body: '',
          visibility: 'org',
          labels: [],
        }),
      });
      expect(refused.status).toBe(412);
      expect(await refused.json()).toMatchObject({ error: 'SKILL_EXISTS' });
      expect(await readFile(skillPath)).toEqual(before);
      expect(mocks.auditSkillWrite).not.toHaveBeenCalled();
      expect(events).toEqual(['begin', 'lock', 'save', 'commit']);

      const created = await app.request('/fresh-skill?orgId=o1', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'if-none-match': '*' },
        body: JSON.stringify({
          description: 'New skill.',
          body: '',
          visibility: 'org',
          labels: [],
        }),
      });
      expect(created.status).toBe(200);
      expect(
        await actual.readSkillForViewer({
          orgSlug: 'acme',
          slug: 'fresh-skill',
          viewer,
        }),
      ).toMatchObject({
        slug: 'fresh-skill',
        description: 'New skill.',
        body: '',
      });

      const edited = await app.request('/house-voice?orgId=o1', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          description: 'Ordinary edit.',
          body: 'Updated instructions.\n',
        }),
      });
      expect(edited.status).toBe(200);
      expect(
        await actual.readSkillForViewer({
          orgSlug: 'acme',
          slug: 'house-voice',
          viewer,
        }),
      ).toMatchObject({
        description: 'Ordinary edit.',
        body: 'Updated instructions.\n',
        visibility: 'team',
        teams: ['team-1'],
        labels: ['preserve'],
      });
      expect(mocks.saveSkillForViewer.mock.lastCall?.[0]).not.toHaveProperty(
        'precondition',
      );
    } finally {
      if (savedConfigDir === undefined) delete process.env.TALE_CONFIG_DIR;
      else process.env.TALE_CONFIG_DIR = savedConfigDir;
      await rm(configRoot, { recursive: true, force: true });
    }
  });
});
