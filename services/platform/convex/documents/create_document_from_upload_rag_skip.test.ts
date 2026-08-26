// The persisted `skipRagIndexing` opt-out, driven end-to-end through a real
// convex-test backend: `createDocumentFromUpload` → internal `saveFileMetadata`
// → `linkDocumentToFile` (whose "legacy second-chance" branch used to re-queue
// any never-indexed row the moment a document linked it — the trap that made
// the per-call hint leak into the org's knowledge corpus). What matters here is
// whether indexing was actually requested, so assertions read the enqueues on
// the indexing workpool. (They read the `_scheduled_functions` system table
// until indexing moved onto a workpool, whose internal scheduling does not
// appear there.)

import rateLimiterComponent from '@convex-dev/rate-limiter/test';
import { convexTest, type TestConvex } from 'convex-test';
import { getFunctionName } from 'convex/server';
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
  beforeEach,
} from 'vitest';

import { api, internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import betterAuthSchema from '../betterAuth/schema';
import schema from '../schema';

// Indexing is enqueued onto a workpool, and a component's internal scheduling
// is NOT visible in the app's `_scheduled_functions` — verified empirically.
// So the pools are mocked and the enqueues observed directly, which asserts the
// same thing the scheduler probe used to: indexing was requested, or was not.
const ragEnqueues = vi.hoisted(() => [] as unknown[][]);
vi.mock('../file_metadata/rag_pools', () => {
  const pool = {
    enqueueAction: (...args: unknown[]) => {
      ragEnqueues.push(args);
      return Promise.resolve('work_test');
    },
  };
  return {
    ragInteractivePool: pool,
    ragBackgroundPool: pool,
    ragPoolFor: () => pool,
  };
});

const TEST_DIR_FROM_CONVEX_ROOT = 'documents';
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

const ORG = 'org_rag_skip';
const USER = 'u_uploader';

type T = TestConvex<typeof schema>;
const testBackends = new Set<T>();

// The saveFileMetadata pipeline schedules background work (extract, retention
// sweep, the RAG upload in the unflagged case) that can warn after a test
// returns; a console-log RPC pending at worker teardown fails the whole run.
// Same posture as records.test.ts. Deliberately not restored — per-file
// isolation brings the console back.
beforeAll(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

// Drain after EVERY test so a backend's in-flight 0-delay jobs never
// interleave with a later test (the known runAfter(0) flake).
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.all(
    [...testBackends].map((t) => t.finishInProgressScheduledFunctions()),
  );
  testBackends.clear();
});

function makeT(): T {
  const t = convexTest(schema, modules);
  rateLimiterComponent.register(t);
  t.registerComponent('betterAuth', betterAuthSchema, authModules);
  testBackends.add(t);
  return t;
}

async function seedMember(t: T): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: `m_${USER}_${ORG}`,
      userId: USER,
      organizationId: ORG,
      role: 'member',
      createdAt: 0,
    });
  });
}

async function storeBlob(t: T): Promise<Id<'_storage'>> {
  return t.run((ctx) => ctx.storage.store(new Blob(['pdf bytes'])));
}

async function fileRow(
  t: T,
  storageId: string,
): Promise<Doc<'fileMetadata'> | null> {
  return t.run((ctx) =>
    ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
      .first(),
  );
}

/** Every RAG-indexing job ever written to the scheduler (rows persist after
 * execution, so this is drain-proof). */
async function ragIndexingJobs(_t: T): Promise<string[]> {
  // One entry per enqueued indexing job. The pool call carries the action as
  // its second argument; its name is what the scheduler probe used to read.
  return ragEnqueues.map((call) =>
    getFunctionName(call[1] as Parameters<typeof getFunctionName>[0]),
  );
}

async function upload(
  t: T,
  fileId: Id<'_storage'>,
  extra: Record<string, unknown> = {},
): Promise<Id<'documents'>> {
  const result = await t
    .withIdentity({ subject: USER })
    .mutation(api.documents.mutations.createDocumentFromUpload, {
      organizationId: ORG,
      fileId,
      fileName: 'report.pdf',
      contentType: 'application/pdf',
      fileSize: 9,
      ...extra,
    });
  return result.documentId;
}

beforeEach(() => {
  ragEnqueues.length = 0;
});

describe('createDocumentFromUpload with skipRagIndexing (full flow)', () => {
  it('persists the opt-out, keeps ragStatus unset and schedules NO RAG indexing — link included', async () => {
    const t = makeT();
    await seedMember(t);
    const fileId = await storeBlob(t);

    const documentId = await upload(t, fileId, { skipRagIndexing: true });

    const row = await fileRow(t, fileId);
    expect(row).not.toBeNull();
    expect(row?.skipRagIndexing).toBe(true);
    expect(row?.ragStatus).toBeUndefined();
    // linkDocumentToFile ran (the row is document-bound) yet its second
    // chance did not resurrect indexing.
    expect(row?.documentId).toBe(documentId);
    expect(await ragIndexingJobs(t)).toEqual([]);
  });

  it('still schedules indexing exactly as today when the flag is absent', async () => {
    const t = makeT();
    await seedMember(t);
    const fileId = await storeBlob(t);

    await upload(t, fileId);

    const row = await fileRow(t, fileId);
    expect(row?.skipRagIndexing).toBeUndefined();
    expect(row?.ragStatus).toBe('queued');
    expect((await ragIndexingJobs(t)).length).toBeGreaterThan(0);
  });

  it('keeps the opt-out sticky across a later re-save without the flag', async () => {
    const t = makeT();
    await seedMember(t);
    const fileId = await storeBlob(t);
    await upload(t, fileId, { skipRagIndexing: true });

    await t.mutation(
      internal.file_metadata.internal_mutations.saveFileMetadata,
      {
        organizationId: ORG,
        storageId: fileId,
        fileName: 'report.pdf',
        contentType: 'application/pdf',
        size: 9,
      },
    );

    const row = await fileRow(t, fileId);
    expect(row?.skipRagIndexing).toBe(true);
    expect(row?.ragStatus).toBeUndefined();
    expect(await ragIndexingJobs(t)).toEqual([]);
  });

  it('refuses the hub scheduling chokepoint for a flagged row', async () => {
    const t = makeT();
    await seedMember(t);
    const fileId = await storeBlob(t);
    const documentId = await upload(t, fileId, { skipRagIndexing: true });

    const scheduled = await t.mutation(
      internal.documents.internal_mutations.scheduleHubDocumentRagIndexing,
      { documentId },
    );

    expect(scheduled).toBe(false);
    const row = await fileRow(t, fileId);
    expect(row?.ragStatus).toBeUndefined();
    expect(await ragIndexingJobs(t)).toEqual([]);
  });

  it('persists the opt-out even when the caller sends no fileSize (intent survives)', async () => {
    const t = makeT();
    await seedMember(t);
    const fileId = await storeBlob(t);

    const documentId = await upload(t, fileId, {
      fileSize: undefined,
      skipRagIndexing: true,
    });

    const row = await fileRow(t, fileId);
    expect(row).not.toBeNull();
    expect(row?.skipRagIndexing).toBe(true);
    expect(row?.ragStatus).toBeUndefined();
    expect(row?.documentId).toBe(documentId);
    // Authoritative byte count from the `_storage` system table, not 0.
    expect(row?.size).toBe(9);
    expect(await ragIndexingJobs(t)).toEqual([]);
  });
});
