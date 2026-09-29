// @vitest-environment node

/**
 * The bundle-upload lane's replace decision (does a bundle exist, may this
 * member replace it, whose skill does it stay) must be taken INSIDE the
 * per-(org, slug) writer lock, like the editor's save. Decided before it,
 * two concurrent uploads of one new slug both observed "no bundle", neither
 * answered needs_confirm, and the second silently overwrote the first.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgSkill } from '../../../lib/skills/listing.ts';
import { readOrgSkill } from '../../../lib/skills/listing.ts';
import { s3DeleteObject } from '../../core/lib/storage/object_store.ts';
import {
  describeBundleWrite,
  prepareBundleWrite,
} from '../../core/skills/file_actions.ts';
import {
  listSkillBundleFileEntries,
  readSkillBundleFiles,
  SkillBundleError,
  writeSkillBundleFiles,
} from '../../core/skills/file_utils.ts';
import { auditSkillWrite } from './audit.ts';
import { uploadSkillBundlePg } from './upload.ts';

vi.mock('../files/upload-intents.ts', () => ({
  consumeUploadIntent: vi.fn(() => Promise.resolve(true)),
}));
vi.mock('../../core/lib/storage/blob_ref.ts', () => ({
  parseBlobRef: vi.fn(() => ({ backend: 's3', key: 'acme/skill_bundle/x' })),
  s3KeyBelongsToOrg: vi.fn(() => true),
}));
vi.mock('../../lib/object-store.ts', () => ({
  resolveObjectStore: vi.fn(() => Promise.resolve({ bucket: 'tale' })),
}));
vi.mock('../../core/lib/storage/object_store.ts', () => ({
  s3GetObjectBytes: vi.fn(() => Promise.resolve(new Uint8Array(16))),
  s3DeleteObject: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../core/skills/bundle_zip.ts', () => ({
  parseSkillBundleZip: vi.fn(() => Promise.resolve({ slug: 'house-voice' })),
}));
const revision = vi.hoisted(() => (etag: string) => ({
  meta: { name: 'house-voice', description: 'd', visibility: 'org', extra: {} },
  body: 'x\n',
  etag,
}));
vi.mock('../../core/skills/file_actions.ts', () => ({
  prepareBundleWrite: vi.fn(() => Promise.resolve([])),
  describeBundleWrite: vi.fn((args: { existing: unknown }) => ({
    previous: args.existing === null ? null : revision('"before"'),
    current: revision('"after"'),
    filesChanged: false,
  })),
}));
vi.mock('../../core/skills/file_utils.ts', async () => {
  class BundleRefusal extends Error {}
  return {
    createOrgSkillReader: vi.fn(() => ({})),
    listSkillBundleFileEntries: vi.fn(),
    readSkillBundleFiles: vi.fn(() => Promise.resolve([])),
    SkillBundleError: BundleRefusal,
    writeSkillBundleFiles: vi.fn(),
  };
});
vi.mock('./audit.ts', () => ({
  auditSkillWrite: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../../lib/skills/listing.ts', () => ({
  readOrgSkill: vi.fn(),
}));

/**
 * A `sql` double whose `begin` is a real mutex: transactions run one at a
 * time, which is what the advisory lock buys on Postgres.
 */
function fakeSql(events: string[]): Sql {
  let chain: Promise<unknown> = Promise.resolve();
  const tx = (strings: TemplateStringsArray) => {
    if (strings.join('?').includes('pg_advisory_xact_lock')) {
      events.push('lock');
    }
    return Promise.resolve([]);
  };
  const begin = async (work: (tx: unknown) => Promise<unknown>) => {
    const previous = chain;
    let release!: () => void;
    chain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    events.push('begin');
    try {
      return await work(tx);
    } finally {
      events.push('commit');
      release();
    }
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { begin } as unknown as Sql;
}

const alice = {
  kind: 'user' as const,
  userId: 'user_alice',
  teamIds: [] as string[],
  isOrgAdmin: false,
};

const actor = { id: 'user_alice', email: 'alice@example.com', role: 'member' };

const existingSkill = {
  slug: 'house-voice',
  path: 'skills/house-voice/SKILL.md',
  meta: { name: 'house-voice', visibility: 'org', owner: 'user_bob' },
} as unknown as OrgSkill;

function upload(sql: Sql, force?: boolean) {
  return uploadSkillBundlePg(sql, {
    organizationId: 'org_1',
    orgSlug: 'acme',
    viewer: alice,
    actor,
    storageId: 's3:acme/skill_bundle/x',
    ...(force === undefined ? {} : { force }),
    assertTeamsAssignable: () => Promise.resolve(),
  });
}

beforeEach(() => {
  vi.mocked(readOrgSkill).mockReset();
  vi.mocked(listSkillBundleFileEntries).mockReset();
  vi.mocked(writeSkillBundleFiles).mockReset();
  vi.mocked(s3DeleteObject).mockClear();
  vi.mocked(auditSkillWrite).mockReset();
  vi.mocked(auditSkillWrite).mockResolvedValue(undefined);
  vi.mocked(readSkillBundleFiles).mockClear();
  vi.mocked(describeBundleWrite).mockClear();
});

describe('uploadSkillBundlePg', () => {
  it('checks the audience on the connection that holds the writer lock', async () => {
    const events: string[] = [];
    vi.mocked(readOrgSkill).mockResolvedValue(null);
    vi.mocked(listSkillBundleFileEntries).mockResolvedValue(null);
    vi.mocked(prepareBundleWrite).mockImplementationOnce(async (args) => {
      await args.assertTeamsAssignable(['mine']);
      return [];
    });
    await uploadSkillBundlePg(fakeSql(events), {
      organizationId: 'org_1',
      orgSlug: 'acme',
      viewer: alice,
      actor,
      storageId: 's3:acme/skill_bundle/x',
      assertTeamsAssignable: async (_ids, tx) => {
        expect(events).toEqual(['begin', 'lock']);
        await tx`SELECT 'audience check on the held connection'`;
        events.push('audience');
      },
    });
    expect(events).toEqual(['begin', 'lock', 'audience', 'commit']);
  });

  it('reads the existing bundle and writes inside one writer-lock transaction', async () => {
    const events: string[] = [];
    vi.mocked(readOrgSkill).mockImplementation(async () => {
      events.push('read');
      return null;
    });
    vi.mocked(listSkillBundleFileEntries).mockImplementation(async () => {
      events.push('entries');
      return null;
    });
    vi.mocked(writeSkillBundleFiles).mockImplementation(async () => {
      events.push('write');
    });
    vi.mocked(auditSkillWrite).mockImplementation(async () => {
      events.push('audit');
    });

    expect(await upload(fakeSql(events))).toEqual({
      ok: true,
      slug: 'house-voice',
    });
    expect(events).toEqual([
      'begin',
      'lock',
      'read',
      'entries',
      'write',
      'audit',
      'commit',
    ]);
    expect(s3DeleteObject).toHaveBeenCalledTimes(1);
  });

  it('answers needs_confirm to the second of two concurrent uploads of one new slug', async () => {
    let written = false;
    vi.mocked(readOrgSkill).mockImplementation(async () =>
      written ? existingSkill : null,
    );
    vi.mocked(listSkillBundleFileEntries).mockImplementation(async () =>
      written ? [{ path: 'SKILL.md', size: 1 }] : null,
    );
    vi.mocked(writeSkillBundleFiles).mockImplementation(async () => {
      written = true;
    });
    const sql = fakeSql([]);

    const outcomes = await Promise.all([upload(sql), upload(sql)]);

    expect(outcomes).toContainEqual({ ok: true, slug: 'house-voice' });
    expect(outcomes).toContainEqual({
      ok: false,
      status: 'needs_confirm',
      slug: 'house-voice',
    });
    expect(writeSkillBundleFiles).toHaveBeenCalledTimes(1);
    // Both attempts release their staged blob, refused or not.
    expect(s3DeleteObject).toHaveBeenCalledTimes(2);
  });

  it('refuses a forced replacement the member may not edit, without writing', async () => {
    vi.mocked(readOrgSkill).mockResolvedValue(existingSkill);
    vi.mocked(listSkillBundleFileEntries).mockResolvedValue([]);

    await expect(upload(fakeSql([]), true)).rejects.toMatchObject({
      data: { code: 'SKILL_FORBIDDEN' },
    });
    expect(writeSkillBundleFiles).not.toHaveBeenCalled();
    expect(s3DeleteObject).toHaveBeenCalledTimes(1);
  });

  it('records a new slug as created, by the uploader, through the upload door', async () => {
    vi.mocked(readOrgSkill).mockResolvedValue(null);
    vi.mocked(listSkillBundleFileEntries).mockResolvedValue(null);

    await upload(fakeSql([]));

    expect(readSkillBundleFiles).not.toHaveBeenCalled();
    expect(auditSkillWrite).toHaveBeenCalledTimes(1);
    expect(vi.mocked(auditSkillWrite).mock.calls[0]?.[1]).toMatchObject({
      organizationId: 'org_1',
      slug: 'house-voice',
      actor,
      via: 'upload',
      previous: null,
      current: { etag: '"after"' },
    });
  });

  it('records a replacement against the bundle it replaced', async () => {
    const owned = {
      ...existingSkill,
      meta: { ...existingSkill.meta, owner: 'user_alice' },
    } as unknown as OrgSkill;
    vi.mocked(readOrgSkill).mockResolvedValue(owned);
    vi.mocked(listSkillBundleFileEntries).mockResolvedValue([]);

    await upload(fakeSql([]), true);

    expect(readSkillBundleFiles).toHaveBeenCalledWith('acme', 'house-voice');
    expect(vi.mocked(describeBundleWrite).mock.calls[0]?.[0]).toMatchObject({
      slug: 'house-voice',
      existing: owned,
      stored: [],
    });
    expect(vi.mocked(auditSkillWrite).mock.calls[0]?.[1]).toMatchObject({
      via: 'upload',
      previous: { etag: '"before"' },
      current: { etag: '"after"' },
    });
  });

  it('still replaces a bundle whose files cannot be walked, recording them as changed', async () => {
    const owned = {
      ...existingSkill,
      meta: { ...existingSkill.meta, owner: 'user_alice' },
    } as unknown as OrgSkill;
    vi.mocked(readOrgSkill).mockResolvedValue(owned);
    vi.mocked(listSkillBundleFileEntries).mockResolvedValue([]);
    vi.mocked(readSkillBundleFiles).mockRejectedValueOnce(
      new SkillBundleError('/srv/acme/skills/house-voice', 'x', 'a symlink'),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(await upload(fakeSql([]), true)).toEqual({
      ok: true,
      slug: 'house-voice',
    });
    expect(vi.mocked(describeBundleWrite).mock.calls[0]?.[0]).toMatchObject({
      stored: null,
    });
    expect(writeSkillBundleFiles).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
