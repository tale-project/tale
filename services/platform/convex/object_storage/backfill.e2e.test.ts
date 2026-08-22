/**
 * E2E — the per-org blob BACKFILL (`migrateOrgBlobsToObjectStorage`) against a
 * REAL S3-compatible store (MinIO) with a real convex-test world (real schema,
 * real indexes, real `_storage`, the real internal queries/mutations). Gated
 * behind `OBJECT_STORAGE_E2E` so the ordinary unit suite (no MinIO) skips it —
 * same contract as the sibling `lib/storage/object_storage_*.e2e.test.ts`
 * suites:
 *
 *   docker start tale-minio-test   # MinIO on http://127.0.0.1:9100
 *   OBJECT_STORAGE_E2E=1 bunx vitest --run --project server object_storage/backfill.e2e
 *
 * What it proves, per the backfill's contract:
 *   1. happy path — every convex-backed ref (fileMetadata.storageId,
 *      documents.fileId, documents.historyFiles[]) ends up IN THE BUCKET,
 *      byte-identical, rows rewritten to `s3:`, `_storage` sources deleted;
 *   2. idempotency — a second run is a no-op;
 *   3. crash states converge — an orphaned bucket copy (crash after PUT,
 *      before rewrite) and a rewritten-but-source-kept state (crash between
 *      the old two-step rewrite/delete) both re-run to a readable end state;
 *   4. a storageId shared across fileMetadata + documents.historyFiles (+ a
 *      second document's fileId) has ALL rows rewritten to ONE object before
 *      the single delete;
 *   5. multi-org isolation on a SHARED bucket — org A's run touches only org
 *      A's rows and namespace, org B untouched;
 *   6. failure accounting — an unreadable blob is counted + skipped, the rest
 *      migrate, the run completes;
 *   7. dry-run — counts + samples, writes NOTHING;
 *   plus: fail-closed refusal when the org has no bucket configured, and the
 *   budget/continuation machinery (manual resume + the scheduler chain).
 */

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { convexTest } from 'convex-test';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import { parseBlobRef } from '../lib/storage/blob_ref';
import {
  buildS3ObjectStore,
  s3DeleteObject,
  s3GetObjectBytes,
  s3ListObjectKeys,
  type S3ObjectStore,
} from '../lib/storage/object_store';
import schema from '../schema';

const RUN = !!process.env.OBJECT_STORAGE_E2E;
const ENDPOINT = 'http://127.0.0.1:9100';
const BUCKET = 'org-blobs';
const SECRETS = { accessKeyId: 'testkey', secretAccessKey: 'testsecret123' };

// Build the module map keyed from the convex root (same pattern as the SCIM /
// Slack http_actions tests) so convex-test can resolve every function.
const TEST_DIR_FROM_CONVEX_ROOT = 'object_storage';
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

type Tester = ReturnType<typeof convexTest>;
type RunDoc = Doc<'objectStorageBackfillRuns'>;

let configRoot = '';

// The MinIO bucket persists across suite executions, so every run gets its own
// slug namespace (`<slug>/<uuid>` object keys) — otherwise `bucketKeys` counts
// a previous run's leftovers. The suite deletes what it created on teardown.
const RUN_NONCE = Math.random().toString(36).slice(2, 8);
const usedSlugs: string[] = [];
function uniqueSlug(base: string): string {
  const slug = `${base}-${RUN_NONCE}`;
  if (!usedSlugs.includes(slug)) usedSlugs.push(slug);
  return slug;
}

/** Write the org's object-storage connection (plaintext secrets — no SOPS key). */
async function configureOrgBucket(slug: string): Promise<void> {
  const dir = join(configRoot, slug, 'object-storage');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'connection.json'),
    JSON.stringify(
      {
        region: 'us-east-1',
        endpoint: ENDPOINT,
        forcePathStyle: true,
        bucket: BUCKET,
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(dir, 'connection.secrets.json'),
    JSON.stringify(SECRETS, null, 2),
  );
}

const store: () => S3ObjectStore = () =>
  buildS3ObjectStore(
    {
      region: 'us-east-1',
      endpoint: ENDPOINT,
      forcePathStyle: true,
      bucket: BUCKET,
    },
    SECRETS,
  );

/** Object keys physically present under the org's namespace in the bucket. */
async function bucketKeys(slug: string): Promise<string[]> {
  return await s3ListObjectKeys(store(), `${slug}/`);
}

async function seedFileRow(
  t: Tester,
  organizationId: string,
  fileName: string,
  content: string,
  contentType = 'text/plain',
): Promise<{ storageId: Id<'_storage'>; rowId: Id<'fileMetadata'> }> {
  return await t.run(async (ctx) => {
    const bytes = new TextEncoder().encode(content);
    const storageId = await ctx.storage.store(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a Uint8Array is a valid BlobPart at runtime
      new Blob([bytes], { type: contentType }),
    );
    const rowId = await ctx.db.insert('fileMetadata', {
      organizationId,
      storageId,
      fileName,
      contentType,
      size: bytes.byteLength,
    });
    return { storageId, rowId };
  });
}

async function seedStorageBlob(
  t: Tester,
  content: string,
  contentType = 'text/plain',
): Promise<Id<'_storage'>> {
  return await t.run(async (ctx) => {
    const bytes = new TextEncoder().encode(content);
    return await ctx.storage.store(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a Uint8Array is a valid BlobPart at runtime
      new Blob([bytes], { type: contentType }),
    );
  });
}

async function storageBlobExists(
  t: Tester,
  storageId: Id<'_storage'>,
): Promise<boolean> {
  return await t.run(async (ctx) => {
    return (await ctx.db.system.get(storageId)) !== null;
  });
}

async function createRun(
  t: Tester,
  organizationId: string,
  orgSlug: string,
  dryRun = false,
): Promise<Id<'objectStorageBackfillRuns'>> {
  return await t.mutation(internal.object_storage.backfill_internal.createRun, {
    organizationId,
    orgSlug,
    dryRun,
  });
}

/** Create a run and drive the engine (single invocation) — the operator path. */
async function runBackfill(
  t: Tester,
  organizationId: string,
  orgSlug: string,
  dryRun = false,
): Promise<RunDoc> {
  const runId = await createRun(t, organizationId, orgSlug, dryRun);
  await t.action(
    internal.object_storage.backfill_actions.migrateOrgBlobsToObjectStorage,
    { organizationId, runId },
  );
  const run = await t.run(async (ctx) => ctx.db.get(runId));
  if (!run) throw new Error('run row vanished');
  return run;
}

const KNOB_NAMES = [
  'OBJECT_STORAGE_BACKFILL_BUDGET_MS',
  'OBJECT_STORAGE_BACKFILL_PAGE_SIZE',
  'OBJECT_STORAGE_BACKFILL_MAX_PAGES_PER_RUN',
  'OBJECT_STORAGE_BACKFILL_MAX_CONTINUATIONS',
  'OBJECT_STORAGE_BACKFILL_PACING_MS',
] as const;

describe.skipIf(!RUN)(
  'per-org object storage — blob backfill engine (MinIO + convex-test)',
  { timeout: 120_000 },
  () => {
    beforeAll(async () => {
      configRoot = await mkdtemp(join(tmpdir(), 'obj-store-backfill-e2e-'));
      process.env.TALE_CONFIG_DIR = configRoot;
      return () => {
        delete process.env.TALE_CONFIG_DIR;
      };
    });

    afterEach(() => {
      for (const name of KNOB_NAMES) delete process.env[name];
      vi.useRealTimers();
    });

    afterAll(async () => {
      // Leave the shared test bucket the way we found it.
      for (const slug of usedSlugs) {
        try {
          for (const key of await bucketKeys(slug)) {
            await s3DeleteObject(store(), key);
          }
        } catch (err) {
          console.warn(
            `[backfill.e2e] bucket cleanup for '${slug}' failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    });

    it('HAPPY PATH: moves fileMetadata + documents (fileId, historyFiles) blobs into the bucket, byte-identical', async () => {
      const ORG = 'org_bf_happy';
      const SLUG = uniqueSlug('bf-happy-org');
      await configureOrgBucket(SLUG);
      const t = convexTest(schema, modules);

      // Standalone upload (chat attachment shape).
      const fileA = await seedFileRow(
        t,
        ORG,
        'notes.txt',
        'standalone upload bytes 📎',
      );
      // Hub document: current fileId (with its fileMetadata row) + one history revision.
      const docCurrent = await seedFileRow(
        t,
        ORG,
        'report.md',
        '# current revision',
        'text/markdown',
      );
      const historyBlob = await seedStorageBlob(t, 'old revision v1');
      const docId = await t.run(async (ctx) =>
        ctx.db.insert('documents', {
          organizationId: ORG,
          title: 'Quarterly report',
          fileId: docCurrent.storageId,
          historyFiles: [historyBlob],
          mimeType: 'text/markdown',
        }),
      );
      // A second document pointing at the SAME current fileId (cross-doc share).
      const doc2Id = await t.run(async (ctx) =>
        ctx.db.insert('documents', {
          organizationId: ORG,
          title: 'Report (copy)',
          fileId: docCurrent.storageId,
        }),
      );

      const run = await runBackfill(t, ORG, SLUG);
      expect(run.status).toBe('completed');
      expect(run.phase).toBe('done');
      expect(run.failed).toBe(0);
      expect(run.skipped).toBe(0);
      // Three distinct blobs: fileA, the shared current fileId, the history blob.
      expect(run.migrated).toBe(3);
      expect(run.bytesMigrated).toBeGreaterThan(0);

      // Rows rewritten to s3 refs.
      const fileARow = await t.run(async (ctx) => ctx.db.get(fileA.rowId));
      const doc = await t.run(async (ctx) => ctx.db.get(docId));
      const doc2 = await t.run(async (ctx) => ctx.db.get(doc2Id));
      const currentRow = await t.run(async (ctx) =>
        ctx.db.get(docCurrent.rowId),
      );
      expect(String(fileARow?.storageId).startsWith('s3:')).toBe(true);
      expect(String(doc?.fileId).startsWith('s3:')).toBe(true);
      expect(String(doc?.historyFiles?.[0]).startsWith('s3:')).toBe(true);
      // The shared current blob got ONE object: doc.fileId, doc2.fileId and the
      // upload row all point at the same ref.
      expect(doc2?.fileId).toBe(doc?.fileId);
      expect(currentRow?.storageId).toBe(doc?.fileId);

      // Convex sources are gone.
      expect(await storageBlobExists(t, fileA.storageId)).toBe(false);
      expect(await storageBlobExists(t, docCurrent.storageId)).toBe(false);
      expect(await storageBlobExists(t, historyBlob)).toBe(false);

      // Physically in the bucket, namespaced under the org slug, byte-identical.
      const keys = await bucketKeys(SLUG);
      expect(keys).toHaveLength(3);
      const contentsByRef = new Map<string, string>();
      for (const ref of [
        String(fileARow?.storageId),
        String(doc?.fileId),
        String(doc?.historyFiles?.[0]),
      ]) {
        const parsed = parseBlobRef(ref);
        expect(parsed.backend).toBe('s3');
        if (parsed.backend !== 's3') throw new Error('ref not s3');
        expect(keys).toContain(parsed.key);
        contentsByRef.set(
          ref,
          new TextDecoder().decode(await s3GetObjectBytes(store(), parsed.key)),
        );
      }
      expect(contentsByRef.get(String(fileARow?.storageId))).toBe(
        'standalone upload bytes 📎',
      );
      expect(contentsByRef.get(String(doc?.fileId))).toBe('# current revision');
      expect(contentsByRef.get(String(doc?.historyFiles?.[0]))).toBe(
        'old revision v1',
      );
    });

    it('IDEMPOTENCY: a second run scans everything and moves nothing', async () => {
      const ORG = 'org_bf_idem';
      const SLUG = uniqueSlug('bf-idem-org');
      await configureOrgBucket(SLUG);
      const t = convexTest(schema, modules);

      const file = await seedFileRow(t, ORG, 'a.txt', 'idempotency bytes');
      await t.run(async (ctx) =>
        ctx.db.insert('documents', {
          organizationId: ORG,
          title: 'doc',
          fileId: file.storageId,
        }),
      );

      const first = await runBackfill(t, ORG, SLUG);
      expect(first.status).toBe('completed');
      expect(first.migrated).toBe(1);
      const keysAfterFirst = await bucketKeys(SLUG);
      const rowAfterFirst = await t.run(async (ctx) => ctx.db.get(file.rowId));

      const second = await runBackfill(t, ORG, SLUG);
      expect(second.status).toBe('completed');
      expect(second.migrated).toBe(0);
      expect(second.failed).toBe(0);
      expect(second.skipped).toBe(0);
      expect(second.rowsScanned).toBeGreaterThan(0);

      // No new objects, refs unchanged.
      expect(await bucketKeys(SLUG)).toEqual(keysAfterFirst);
      const rowAfterSecond = await t.run(async (ctx) => ctx.db.get(file.rowId));
      expect(rowAfterSecond?.storageId).toBe(rowAfterFirst?.storageId);
    });

    it('CRASH after PUT before rewrite: an orphaned bucket copy does not block convergence', async () => {
      const ORG = 'org_bf_crash_put';
      const SLUG = uniqueSlug('bf-crash-put-org');
      await configureOrgBucket(SLUG);
      const t = convexTest(schema, modules);

      const file = await seedFileRow(t, ORG, 'crash.txt', 'crash-window bytes');
      // Simulate the crash's leftover: the bytes were already copied into the
      // bucket, but no row was rewritten and the source still exists.
      const { s3PutObject, buildObjectKey } =
        await import('../lib/storage/object_store');
      const orphanKey = buildObjectKey(store(), SLUG);
      await s3PutObject(
        store(),
        orphanKey,
        new TextEncoder().encode('crash-window bytes'),
        'text/plain',
      );

      const run = await runBackfill(t, ORG, SLUG);
      expect(run.status).toBe('completed');
      expect(run.migrated).toBe(1);
      expect(run.failed).toBe(0);

      const row = await t.run(async (ctx) => ctx.db.get(file.rowId));
      const parsed = parseBlobRef(String(row?.storageId));
      expect(parsed.backend).toBe('s3');
      if (parsed.backend !== 's3') throw new Error('ref not s3');
      // The re-run copied afresh (a new key); the orphan stays as a harmless
      // duplicate inside the org's own namespace. No dangling ref anywhere.
      expect(parsed.key).not.toBe(orphanKey);
      expect(
        new TextDecoder().decode(await s3GetObjectBytes(store(), parsed.key)),
      ).toBe('crash-window bytes');
      expect(await storageBlobExists(t, file.storageId)).toBe(false);
    });

    it('CRASH between rewrite and delete (legacy two-step state): re-run is a clean no-op, data readable', async () => {
      const ORG = 'org_bf_crash_del';
      const SLUG = uniqueSlug('bf-crash-del-org');
      await configureOrgBucket(SLUG);
      const t = convexTest(schema, modules);

      // Construct the state directly: the row already points at a bucket object
      // holding the bytes, while the _storage source was never deleted. (The
      // engine's atomic rewrite+delete mutation cannot produce this state; it
      // covers a crash of the older two-step flow or a manual partial move.)
      const { s3PutObject, buildObjectKey } =
        await import('../lib/storage/object_store');
      const key = buildObjectKey(store(), SLUG);
      await s3PutObject(
        store(),
        key,
        new TextEncoder().encode('already moved bytes'),
        'text/plain',
      );
      const orphanSource = await seedStorageBlob(t, 'already moved bytes');
      const rowId = await t.run(async (ctx) =>
        ctx.db.insert('fileMetadata', {
          organizationId: ORG,
          storageId: `s3:${key}`,
          fileName: 'moved.txt',
          contentType: 'text/plain',
          size: 'already moved bytes'.length,
        }),
      );

      const run = await runBackfill(t, ORG, SLUG);
      expect(run.status).toBe('completed');
      expect(run.migrated).toBe(0);
      expect(run.failed).toBe(0);
      expect(run.rowsScanned).toBe(1);

      // The ref is untouched and readable; the orphaned _storage source is NOT
      // deleted (no row references it — it is invisible to row enumeration by
      // design, and deleting unreferenced _storage blobs deployment-wide would
      // endanger tables the seam does not route yet).
      const row = await t.run(async (ctx) => ctx.db.get(rowId));
      expect(row?.storageId).toBe(`s3:${key}`);
      expect(
        new TextDecoder().decode(await s3GetObjectBytes(store(), key)),
      ).toBe('already moved bytes');
      expect(await storageBlobExists(t, orphanSource)).toBe(true);
    });

    it('SHARED storageId: fileMetadata + documents.historyFiles + another doc.fileId all rewritten to ONE object before the single delete', async () => {
      const ORG = 'org_bf_shared';
      const SLUG = uniqueSlug('bf-shared-org');
      await configureOrgBucket(SLUG);
      const t = convexTest(schema, modules);

      const shared = await seedFileRow(t, ORG, 'shared.bin', 'shared payload');
      const docHistoryId = await t.run(async (ctx) =>
        ctx.db.insert('documents', {
          organizationId: ORG,
          title: 'doc with history',
          historyFiles: [shared.storageId],
        }),
      );
      const docFileId = await t.run(async (ctx) =>
        ctx.db.insert('documents', {
          organizationId: ORG,
          title: 'doc with fileId',
          fileId: shared.storageId,
        }),
      );

      const run = await runBackfill(t, ORG, SLUG);
      expect(run.status).toBe('completed');
      expect(run.migrated).toBe(1);
      expect(run.failed).toBe(0);
      expect(run.skipped).toBe(0);

      const [fmRow, docHistory, docFile] = await t.run(async (ctx) => {
        return [
          await ctx.db.get(shared.rowId),
          await ctx.db.get(docHistoryId),
          await ctx.db.get(docFileId),
        ] as const;
      });
      const ref = String(docHistory?.historyFiles?.[0]);
      expect(ref.startsWith('s3:')).toBe(true);
      // ONE object, all three rows point at it.
      expect(String(fmRow?.storageId)).toBe(ref);
      expect(String(docFile?.fileId)).toBe(ref);
      expect(await bucketKeys(SLUG)).toHaveLength(1);
      expect(await storageBlobExists(t, shared.storageId)).toBe(false);

      const parsed = parseBlobRef(ref);
      if (parsed.backend !== 's3') throw new Error('ref not s3');
      expect(
        new TextDecoder().decode(await s3GetObjectBytes(store(), parsed.key)),
      ).toBe('shared payload');
    });

    it('MULTI-ORG isolation on a SHARED bucket: org A moves only its own rows into its own namespace', async () => {
      const ORG_A = 'org_bf_multi_a';
      const SLUG_A = uniqueSlug('bf-multi-a-org');
      const ORG_B = 'org_bf_multi_b';
      const SLUG_B = uniqueSlug('bf-multi-b-org');
      await configureOrgBucket(SLUG_A);
      await configureOrgBucket(SLUG_B); // same physical bucket, own namespace
      const t = convexTest(schema, modules);

      const fileA = await seedFileRow(t, ORG_A, 'a.txt', 'org A bytes');
      // Same CONTENT in org B — content equality must not cross-link anything.
      const fileB = await seedFileRow(t, ORG_B, 'b.txt', 'org A bytes');
      const docB = await t.run(async (ctx) =>
        ctx.db.insert('documents', {
          organizationId: ORG_B,
          title: 'org B doc',
          fileId: fileB.storageId,
        }),
      );

      const runA = await runBackfill(t, ORG_A, SLUG_A);
      expect(runA.status).toBe('completed');
      expect(runA.migrated).toBe(1);

      // Org A landed in its namespace; org B's namespace is empty and its rows
      // + _storage blob are untouched.
      expect(await bucketKeys(SLUG_A)).toHaveLength(1);
      expect(await bucketKeys(SLUG_B)).toHaveLength(0);
      const rowB = await t.run(async (ctx) => ctx.db.get(fileB.rowId));
      const docRowB = await t.run(async (ctx) => ctx.db.get(docB));
      expect(rowB?.storageId).toBe(fileB.storageId);
      expect(docRowB?.fileId).toBe(fileB.storageId);
      expect(await storageBlobExists(t, fileB.storageId)).toBe(true);
      // Org A's rows moved.
      const rowA = await t.run(async (ctx) => ctx.db.get(fileA.rowId));
      expect(String(rowA?.storageId).startsWith('s3:')).toBe(true);
      expect(await storageBlobExists(t, fileA.storageId)).toBe(false);

      // Org B's own run then converges B into B's namespace only.
      const runB = await runBackfill(t, ORG_B, SLUG_B);
      expect(runB.status).toBe('completed');
      expect(runB.migrated).toBe(1);
      expect(await bucketKeys(SLUG_B)).toHaveLength(1);
      expect(await bucketKeys(SLUG_A)).toHaveLength(1);
      const movedB = await t.run(async (ctx) => ctx.db.get(fileB.rowId));
      const movedDocB = await t.run(async (ctx) => ctx.db.get(docB));
      expect(String(movedB?.storageId).startsWith(`s3:`)).toBe(true);
      expect(movedDocB?.fileId).toBe(movedB?.storageId);
      const parsedB = parseBlobRef(String(movedB?.storageId));
      if (parsedB.backend !== 's3') throw new Error('ref not s3');
      expect(parsedB.key.startsWith(`${SLUG_B}/`)).toBe(true);
    });

    it('FAILURE ACCOUNTING: an unreadable blob is counted + skipped; the rest migrate and the run completes', async () => {
      const ORG = 'org_bf_fail';
      const SLUG = uniqueSlug('bf-fail-org');
      await configureOrgBucket(SLUG);
      const t = convexTest(schema, modules);

      const good1 = await seedFileRow(t, ORG, 'ok1.txt', 'good one');
      const bad = await seedFileRow(t, ORG, 'gone.txt', 'will vanish');
      const good2 = await seedFileRow(t, ORG, 'ok2.txt', 'good two');
      // Make `bad` unreadable: its _storage blob disappears behind the row.
      await t.run(async (ctx) => {
        await ctx.storage.delete(bad.storageId);
      });

      const run = await runBackfill(t, ORG, SLUG);
      expect(run.status).toBe('completed');
      expect(run.migrated).toBe(2);
      expect(run.failed).toBe(1);
      expect(run.skipped).toBe(0);

      const [row1, rowBad, row2] = await t.run(async (ctx) => {
        return [
          await ctx.db.get(good1.rowId),
          await ctx.db.get(bad.rowId),
          await ctx.db.get(good2.rowId),
        ] as const;
      });
      expect(String(row1?.storageId).startsWith('s3:')).toBe(true);
      expect(String(row2?.storageId).startsWith('s3:')).toBe(true);
      // The failed row is left exactly as it was — never rewritten to a ref
      // whose bytes don't exist.
      expect(rowBad?.storageId).toBe(bad.storageId);
      expect(await bucketKeys(SLUG)).toHaveLength(2);
    });

    it('DRY-RUN: counts + samples what would move and writes NOTHING', async () => {
      const ORG = 'org_bf_dry';
      const SLUG = uniqueSlug('bf-dry-org');
      await configureOrgBucket(SLUG);
      const t = convexTest(schema, modules);

      const file = await seedFileRow(t, ORG, 'dry.txt', 'dry-run bytes');
      const history = await seedStorageBlob(t, 'dry history');
      const docId = await t.run(async (ctx) =>
        ctx.db.insert('documents', {
          organizationId: ORG,
          title: 'dry doc',
          fileId: file.storageId,
          historyFiles: [history],
        }),
      );

      const run = await runBackfill(t, ORG, SLUG, true);
      expect(run.status).toBe('completed');
      expect(run.dryRun).toBe(true);
      // Document phase: fileId + history. fileMetadata phase: the same shared
      // storageId counts again (documented per-phase ref counting).
      expect(run.candidates).toBe(3);
      expect(run.candidateBytes).toBe(
        'dry-run bytes'.length * 2 + 'dry history'.length,
      );
      expect(run.migrated).toBe(0);
      expect(run.sample.length).toBe(3);
      expect(run.sample.map((s) => s.table).sort()).toEqual([
        'documents',
        'documents',
        'fileMetadata',
      ]);

      // NOTHING moved or changed.
      expect(await bucketKeys(SLUG)).toHaveLength(0);
      const row = await t.run(async (ctx) => ctx.db.get(file.rowId));
      const doc = await t.run(async (ctx) => ctx.db.get(docId));
      expect(row?.storageId).toBe(file.storageId);
      expect(doc?.fileId).toBe(file.storageId);
      expect(doc?.historyFiles?.[0]).toBe(history);
      expect(await storageBlobExists(t, file.storageId)).toBe(true);
      expect(await storageBlobExists(t, history)).toBe(true);
    });

    it('FAIL-CLOSED: a real run refuses an org without a bucket (dry-run still allowed)', async () => {
      const ORG = 'org_bf_noconf';
      const SLUG = uniqueSlug('bf-noconf-org'); // deliberately NOT configured
      const t = convexTest(schema, modules);

      const file = await seedFileRow(t, ORG, 'stay.txt', 'must not move');

      const run = await runBackfill(t, ORG, SLUG);
      expect(run.status).toBe('failed');
      expect(run.lastError).toContain('no object-storage connection');
      const row = await t.run(async (ctx) => ctx.db.get(file.rowId));
      expect(row?.storageId).toBe(file.storageId);
      expect(await storageBlobExists(t, file.storageId)).toBe(true);

      // A dry run is a pre-config planning tool — allowed and read-only.
      const dry = await runBackfill(t, ORG, SLUG, true);
      expect(dry.status).toBe('completed');
      expect(dry.candidates).toBe(1);
    });

    it('RESUMABILITY: a budget-stopped run resumes from its cursor on manual re-invocation and converges', async () => {
      const ORG = 'org_bf_resume';
      const SLUG = uniqueSlug('bf-resume-org');
      await configureOrgBucket(SLUG);
      // Fake timers: convex-test backs the scheduler with real setTimeout, so
      // this keeps the never-driven continuation timers inert (we resume by
      // hand, simulating an operator after a crash) and out of the event loop.
      vi.useFakeTimers();
      const t = convexTest(schema, modules);

      const rows = [] as Awaited<ReturnType<typeof seedFileRow>>[];
      for (let i = 0; i < 3; i++) {
        rows.push(await seedFileRow(t, ORG, `part${i}.txt`, `part ${i} bytes`));
      }

      // One page of one row per invocation; pacing pushed far out so the
      // scheduled continuation can never fire during the test — the re-runs
      // below simulate an operator resuming after a crash.
      process.env.OBJECT_STORAGE_BACKFILL_PAGE_SIZE = '1';
      process.env.OBJECT_STORAGE_BACKFILL_MAX_PAGES_PER_RUN = '1';
      process.env.OBJECT_STORAGE_BACKFILL_PACING_MS = '600000';

      const runId = await createRun(t, ORG, SLUG, false);
      await t.action(
        internal.object_storage.backfill_actions.migrateOrgBlobsToObjectStorage,
        { organizationId: ORG, runId },
      );
      let run = await t.run(async (ctx) => ctx.db.get(runId));
      // Invocation 1 consumed the (empty) documents page and stopped at the
      // page cap — mid-run, cursor persisted, continuation scheduled.
      expect(run?.status).toBe('running');
      expect(run?.phase).toBe('fileMetadata');
      expect(run?.migrated).toBe(0);
      expect(run?.continuation).toBe(1);

      // Manual re-invocations (the crash-resume path) converge the run.
      for (let i = 0; i < 6 && run?.status === 'running'; i++) {
        await t.action(
          internal.object_storage.backfill_actions
            .migrateOrgBlobsToObjectStorage,
          { organizationId: ORG, runId },
        );
        run = await t.run(async (ctx) => ctx.db.get(runId));
      }
      expect(run?.status).toBe('completed');
      expect(run?.migrated).toBe(3);
      expect(await bucketKeys(SLUG)).toHaveLength(3);
      for (const seeded of rows) {
        const row = await t.run(async (ctx) => ctx.db.get(seeded.rowId));
        expect(String(row?.storageId).startsWith('s3:')).toBe(true);
        expect(await storageBlobExists(t, seeded.storageId)).toBe(false);
      }
    });

    it('CONTINUATION CHAIN: the self-scheduled chain drains a multi-page backlog to completion', async () => {
      const ORG = 'org_bf_chain';
      const SLUG = uniqueSlug('bf-chain-org');
      await configureOrgBucket(SLUG);

      vi.useFakeTimers();
      try {
        const t = convexTest(schema, modules);
        const rows = [] as Awaited<ReturnType<typeof seedFileRow>>[];
        for (let i = 0; i < 3; i++) {
          rows.push(
            await seedFileRow(t, ORG, `chain${i}.txt`, `chain ${i} bytes`),
          );
        }

        process.env.OBJECT_STORAGE_BACKFILL_PAGE_SIZE = '1';
        process.env.OBJECT_STORAGE_BACKFILL_MAX_PAGES_PER_RUN = '1';
        process.env.OBJECT_STORAGE_BACKFILL_PACING_MS = '50';

        const runId = await createRun(t, ORG, SLUG, false);
        await t.action(
          internal.object_storage.backfill_actions
            .migrateOrgBlobsToObjectStorage,
          { organizationId: ORG, runId },
        );
        await t.finishAllScheduledFunctions(vi.runAllTimers);

        const run = await t.run(async (ctx) => ctx.db.get(runId));
        expect(run?.status).toBe('completed');
        expect(run?.migrated).toBe(3);
        expect(run?.continuation).toBeGreaterThan(0);
        expect(await bucketKeys(SLUG)).toHaveLength(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it('SINGLE-FLIGHT: a second start while a run is active is refused', async () => {
      const ORG = 'org_bf_lock';
      const SLUG = uniqueSlug('bf-lock-org');
      await configureOrgBucket(SLUG);
      const t = convexTest(schema, modules);

      await createRun(t, ORG, SLUG, false);
      await expect(createRun(t, ORG, SLUG, false)).rejects.toThrow(
        /already running/i,
      );
    });

    it('ZOMBIE GUARD: progress flushes are rejected once a run is no longer running', async () => {
      const ORG = 'org_bf_zombie';
      const SLUG = uniqueSlug('bf-zombie-org');
      const t = convexTest(schema, modules);

      const runId = await createRun(t, ORG, SLUG, false);
      await t.mutation(internal.object_storage.backfill_internal.finishRun, {
        runId,
        status: 'failed',
        lastError: 'superseded',
      });
      await expect(
        t.mutation(
          internal.object_storage.backfill_internal.updateRunProgress,
          {
            runId,
            phase: 'documents',
            cursor: null,
            continuation: 0,
            rowsScanned: 0,
            migrated: 0,
            skipped: 0,
            failed: 0,
            bytesMigrated: 0,
            candidates: 0,
            candidateBytes: 0,
            sample: [],
          },
        ),
      ).rejects.toThrow(/progress rejected/);
    });
  },
);
