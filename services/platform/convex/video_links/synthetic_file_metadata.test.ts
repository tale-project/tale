// Regression: the captions-branch synthetic fileMetadata must carry the
// CANONICAL `ragStatus`, not only the chip-facing `transcriptRagStatus`.
// `pollFileRagStatus` short-circuits when `ragStatus` is undefined
// (file_metadata/internal_actions.ts) and `document_retrieve` gates on
// `ragStatus === 'completed'` — so omitting it left every captioned video
// transcript permanently "still being indexed" to the agent even though the
// transcript was indexed and searchable. The audio branch already writes both.

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it, vi } from 'vitest';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';

// The synthetic-insert bail path (job erased) reaches a backend-aware blob
// delete; the happy path here never hits it, but the module pulls the node
// seam transitively, so stub it to keep the V8 test bundle clean.
vi.mock('../lib/storage/blob_delete', () => ({
  deleteBlobInMutation: vi.fn(async () => undefined),
  deleteOrgBlobInMutation: vi.fn(async () => undefined),
  scheduleS3BlobDeletes: vi.fn(async () => undefined),
}));

const TEST_DIR_FROM_CONVEX_ROOT = 'video_links';
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

type T = TestConvex<typeof schema>;

const ORG = 'org_video_test';

async function seedJob(t: T): Promise<Id<'videoLinkJobs'>> {
  return t.run(async (ctx) =>
    ctx.db.insert('videoLinkJobs', {
      organizationId: ORG,
      uploadedBy: 'user_1',
      sourceUrl: 'https://www.youtube.com/watch?v=abc123',
      sourceUrlHash: 'hash_abc123',
      sourcePlatform: 'youtube',
      pastedToken: 'https://www.youtube.com/watch?v=abc123',
      status: 'indexing',
      statusChangedAt: Date.now(),
      lifecycleStatus: 'active',
    }),
  );
}

describe('insertSyntheticFileMetadata — captions branch RAG status', () => {
  it('sets the canonical ragStatus (queued), not only transcriptRagStatus', async () => {
    const t = convexTest(schema, modules);
    const jobId = await seedJob(t);

    await t.mutation(
      internal.video_links.internal_mutations.insertSyntheticFileMetadata,
      {
        jobId,
        storageId: 's3:org_video_test/00000000-0000-0000-0000-000000000000',
        transcript: 'Hello world transcript.',
        fileSize: 42,
        videoTitle: 'Test Video',
        videoDurationSec: 12,
        sourceUrl: 'https://www.youtube.com/watch?v=abc123',
        sourcePlatform: 'youtube',
        transcriptSource: 'captions_human',
        captionLang: 'en',
        organizationId: ORG,
        uploadedBy: 'user_1',
      },
    );

    const row = await t.run(async (ctx) =>
      ctx.db
        .query('fileMetadata')
        .filter((q) => q.eq(q.field('organizationId'), ORG))
        .first(),
    );

    expect(row).not.toBeNull();
    // The fix: the retrieval gate reads ragStatus; it must be seeded so the
    // poller advances it to 'completed'.
    expect(row?.ragStatus).toBe('queued');
    // And the chip-facing status stays set too.
    expect(row?.transcriptRagStatus).toBe('queued');
  });
});
