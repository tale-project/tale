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
  listSkillBundleFileEntries,
  writeSkillBundleFiles,
} from '../../core/skills/file_utils.ts';
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
vi.mock('../../core/skills/file_actions.ts', () => ({
  normalizedBundleFiles: vi.fn(() => []),
}));
vi.mock('../../core/skills/file_utils.ts', () => ({
  createOrgSkillReader: vi.fn(() => ({})),
  listSkillBundleFileEntries: vi.fn(),
  writeSkillBundleFiles: vi.fn(),
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
    storageId: 's3:acme/skill_bundle/x',
    ...(force === undefined ? {} : { force }),
  });
}

beforeEach(() => {
  vi.mocked(readOrgSkill).mockReset();
  vi.mocked(listSkillBundleFileEntries).mockReset();
  vi.mocked(writeSkillBundleFiles).mockReset();
  vi.mocked(s3DeleteObject).mockClear();
});

describe('uploadSkillBundlePg', () => {
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
});
