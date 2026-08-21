// The upload handshake of the projects REST door, driven through a real
// convex-test backend: minting binds (org, user, project) and lazily sweeps
// expired rows (reclaiming S3 objects through a scheduled deleteOrgBlobs),
// and consuming is single-use with ONE opaque refusal for every bad
// handshake — absent, expired, foreign org/user/project, s3Ref mismatch,
// and a Convex-lane fileId some fileMetadata row already claims.

import { convexTest, type TestConvex } from 'convex-test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import betterAuthSchema from '../betterAuth/schema';
import schema from '../schema';
import { REST_UPLOAD_INTENT_TTL_MS } from './rest_upload_intents';

// convex-test module map keyed relative to the convex/ root (this file is at
// convex/projects/), mirroring create_document_from_upload_rag_skip.test.ts.
const TEST_DIR_FROM_CONVEX_ROOT = 'projects';
function toConvexRootKey(globKey: string): string {
  const stack: string[] = [];
  for (const part of `${TEST_DIR_FROM_CONVEX_ROOT}/${globKey}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}
const rawModules = import.meta.glob('../**/*.*s');
const modules: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(rawModules)) {
  modules[toConvexRootKey(key)] = loader;
}
const authModules = import.meta.glob('../betterAuth/**/*.*s');

const ORG = 'org_intents';
const OTHER_ORG = 'org_intents_other';
const EDITOR = 'u_editor';

type T = TestConvex<typeof schema>;
const testBackends = new Set<T>();

// The swept deleteOrgBlobs action logs its unresolvable-org skip after a
// test returns; a console RPC pending at worker teardown fails the run.
// Same posture as create_document_from_upload_rag_skip.test.ts.
beforeAll(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.all(
    [...testBackends].map((t) => t.finishInProgressScheduledFunctions()),
  );
  testBackends.clear();
});

function makeT(): T {
  const t = convexTest(schema, modules);
  t.registerComponent('betterAuth', betterAuthSchema, authModules);
  testBackends.add(t);
  return t;
}

async function seedMember(
  t: T,
  userId: string,
  organizationId: string,
  role = 'editor',
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: `m_${userId}_${organizationId}`,
      userId,
      organizationId,
      role,
      createdAt: 0,
    });
  });
}

async function seedProject(
  t: T,
  organizationId: string,
  extra: Record<string, unknown> = {},
): Promise<Id<'projects'>> {
  return t.run(async (ctx) =>
    ctx.db.insert('projects', {
      organizationId,
      name: 'Acme Books',
      createdBy: EDITOR,
      createdAt: 0,
      updatedAt: 0,
      ...extra,
    }),
  );
}

async function mint(
  t: T,
  projectId: Id<'projects'>,
  s3Ref?: string,
): Promise<{ uploadId: Id<'restUploadIntents'>; expiresAt: number }> {
  return t.mutation(
    internal.projects.rest_upload_intents.createRestUploadIntent,
    { organizationId: ORG, userId: EDITOR, projectId, s3Ref },
  );
}

async function consume(
  t: T,
  args: {
    organizationId?: string;
    userId?: string;
    projectId: string;
    uploadId: string;
    fileId: string;
  },
): Promise<null> {
  return t.mutation(
    internal.projects.rest_upload_intents.consumeRestUploadIntent,
    {
      organizationId: args.organizationId ?? ORG,
      userId: args.userId ?? EDITOR,
      projectId: args.projectId,
      uploadId: args.uploadId,
      fileId: args.fileId,
    },
  );
}

function codeOf(error: unknown): string | undefined {
  const raw = (error as { data?: unknown }).data;
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return typeof data === 'object' && data !== null && 'code' in data
    ? String((data as { code: unknown }).code)
    : undefined;
}

async function expectCode(p: Promise<unknown>, code: string): Promise<void> {
  const error = await p.then(
    () => {
      throw new Error(`expected a rejection with code ${code}`);
    },
    (err: unknown) => err,
  );
  expect(codeOf(error)).toBe(code);
}

describe('createRestUploadIntent', () => {
  it('mints a row bound to (org, user, project) and answers its TTL', async () => {
    const t = makeT();
    await seedMember(t, EDITOR, ORG);
    const projectId = await seedProject(t, ORG);

    const before = Date.now();
    const { uploadId, expiresAt } = await mint(t, projectId, 's3:org/key-1');

    const row = await t.run((ctx) => ctx.db.get(uploadId));
    expect(row).toMatchObject({
      organizationId: ORG,
      userId: EDITOR,
      projectId,
      s3Ref: 's3:org/key-1',
    });
    expect(expiresAt).toBeGreaterThanOrEqual(
      before + REST_UPLOAD_INTENT_TTL_MS,
    );
  });

  it('refuses an invisible project as absent, and a plain member as forbidden', async () => {
    const t = makeT();
    await seedMember(t, EDITOR, ORG);
    await seedMember(t, 'u_member', ORG, 'member');
    const restricted = await seedProject(t, ORG, { teamId: 'team_hidden' });
    const orgWide = await seedProject(t, ORG);

    // Editor without the owning team: cannot see it → reads as absent.
    await expectCode(mint(t, restricted), 'PROJECT_NOT_FOUND');

    // Member CAN see the org-wide project but may not edit it.
    await expectCode(
      t.mutation(internal.projects.rest_upload_intents.createRestUploadIntent, {
        organizationId: ORG,
        userId: 'u_member',
        projectId: orgWide,
      }),
      'RBAC_FORBIDDEN',
    );
  });

  it('lazily sweeps expired rows on mint and schedules blob cleanup for their s3Refs', async () => {
    const t = makeT();
    await seedMember(t, EDITOR, ORG);
    const projectId = await seedProject(t, ORG);

    const staleWithBlob = await t.run((ctx) =>
      ctx.db.insert('restUploadIntents', {
        organizationId: ORG,
        userId: EDITOR,
        projectId,
        s3Ref: 's3:org/stale-object',
        createdAt: Date.now() - REST_UPLOAD_INTENT_TTL_MS - 1000,
      }),
    );
    const staleConvexLane = await t.run((ctx) =>
      ctx.db.insert('restUploadIntents', {
        organizationId: ORG,
        userId: EDITOR,
        projectId,
        createdAt: Date.now() - REST_UPLOAD_INTENT_TTL_MS - 1000,
      }),
    );

    const { uploadId } = await mint(t, projectId);

    expect(await t.run((ctx) => ctx.db.get(staleWithBlob))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(staleConvexLane))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(uploadId))).not.toBeNull();

    // The S3-lane corpse names its object → a deleteOrgBlobs job carries it.
    const jobs = await t.run(async (ctx) => {
      const fns = await ctx.db.system.query('_scheduled_functions').collect();
      return fns.filter((fn) => fn.name.includes('deleteOrgBlobs'));
    });
    expect(jobs.length).toBe(1);
    expect(JSON.stringify(jobs[0]?.args)).toContain('s3:org/stale-object');
  });
});

describe('consumeRestUploadIntent', () => {
  it('consumes the matching s3-lane handshake exactly once (reuse refused)', async () => {
    const t = makeT();
    await seedMember(t, EDITOR, ORG);
    const projectId = await seedProject(t, ORG);
    const { uploadId } = await mint(t, projectId, 's3:org/key-1');

    await consume(t, { projectId, uploadId, fileId: 's3:org/key-1' });
    expect(await t.run((ctx) => ctx.db.get(uploadId))).toBeNull();

    await expectCode(
      consume(t, { projectId, uploadId, fileId: 's3:org/key-1' }),
      'UPLOAD_BLOB_INVALID',
    );
  });

  it('refuses an s3Ref mismatch without consuming the intent', async () => {
    const t = makeT();
    await seedMember(t, EDITOR, ORG);
    const projectId = await seedProject(t, ORG);
    const { uploadId } = await mint(t, projectId, 's3:org/key-1');

    await expectCode(
      consume(t, { projectId, uploadId, fileId: 's3:org/other-key' }),
      'UPLOAD_BLOB_INVALID',
    );
    expect(await t.run((ctx) => ctx.db.get(uploadId))).not.toBeNull();
  });

  it('refuses foreign org, foreign user, foreign project, and garbage uploadIds identically', async () => {
    const t = makeT();
    await seedMember(t, EDITOR, ORG);
    await seedMember(t, EDITOR, OTHER_ORG);
    const projectId = await seedProject(t, ORG);
    const otherProject = await seedProject(t, ORG);
    const { uploadId } = await mint(t, projectId, 's3:org/key-1');

    const attempts: Array<Parameters<typeof consume>[1]> = [
      // Foreign org (its own project id, same intent id).
      {
        organizationId: OTHER_ORG,
        projectId,
        uploadId,
        fileId: 's3:org/key-1',
      },
      // Foreign user.
      { userId: 'u_other', projectId, uploadId, fileId: 's3:org/key-1' },
      // Another project of the same org.
      { projectId: otherProject, uploadId, fileId: 's3:org/key-1' },
      // Garbage uploadId.
      { projectId, uploadId: 'not-an-id', fileId: 's3:org/key-1' },
    ];
    for (const attempt of attempts) {
      await expectCode(consume(t, attempt), 'UPLOAD_BLOB_INVALID');
    }
    // None of the refusals consumed the real handshake.
    expect(await t.run((ctx) => ctx.db.get(uploadId))).not.toBeNull();
  });

  it('refuses an expired handshake even with the matching fileId (the sweep collects it)', async () => {
    const t = makeT();
    await seedMember(t, EDITOR, ORG);
    const projectId = await seedProject(t, ORG);
    const uploadId = await t.run((ctx) =>
      ctx.db.insert('restUploadIntents', {
        organizationId: ORG,
        userId: EDITOR,
        projectId,
        s3Ref: 's3:org/expired-object',
        createdAt: Date.now() - REST_UPLOAD_INTENT_TTL_MS - 1000,
      }),
    );

    await expectCode(
      consume(t, { projectId, uploadId, fileId: 's3:org/expired-object' }),
      'UPLOAD_BLOB_INVALID',
    );
    // A throwing mutation rolls its own writes back, so the corpse is left
    // in place ON PURPOSE — the next mint's lazy sweep deletes it and
    // reclaims its S3 object (pinned in the sweep test above).
    expect(await t.run((ctx) => ctx.db.get(uploadId))).not.toBeNull();
  });

  it('Convex lane: refuses a malformed fileId and one already claimed by fileMetadata', async () => {
    const t = makeT();
    await seedMember(t, EDITOR, ORG);
    const projectId = await seedProject(t, ORG);

    const { uploadId: first } = await mint(t, projectId);
    await expectCode(
      consume(t, { projectId, uploadId: first, fileId: 'not-a-storage-id' }),
      'UPLOAD_BLOB_INVALID',
    );

    const claimed = await t.run((ctx) => ctx.storage.store(new Blob(['x'])));
    await t.run(async (ctx) => {
      await ctx.db.insert('fileMetadata', {
        organizationId: ORG,
        storageId: claimed,
        fileName: 'taken.pdf',
        contentType: 'application/pdf',
        size: 1,
      });
    });
    await expectCode(
      consume(t, { projectId, uploadId: first, fileId: claimed }),
      'UPLOAD_BLOB_INVALID',
    );

    // An unclaimed, valid _storage id consumes cleanly.
    const fresh = await t.run((ctx) => ctx.storage.store(new Blob(['y'])));
    await consume(t, { projectId, uploadId: first, fileId: fresh });
    expect(await t.run((ctx) => ctx.db.get(first))).toBeNull();
  });
});
