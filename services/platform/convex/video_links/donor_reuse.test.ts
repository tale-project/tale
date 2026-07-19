// Org-wide transcript reuse: a URL already transcribed in the org (any
// thread, any user, ≤30 days) is attached by cloning the donor row instead
// of re-running yt-dlp. These tests cover the two server pieces: the donor
// lookup (`findReusableTranscriptDonor`) — including the remove→re-add case
// where the cancelled chip's fileMetadata row survives as the donor — and
// the clone finalizer (`finalizeClonedTranscript`), including its
// cancel-race guard and the verbatim-transcript contract (the donor text
// already carries the provenance header; re-prepending would double it).

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it, vi } from 'vitest';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { deleteOrgBlobInMutation } from '../lib/storage/blob_delete';
import schema from '../schema';
import {
  findReusableTranscriptDonor,
  TRANSCRIPT_REUSE_MAX_AGE_MS,
} from './donor';

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

const ORG = 'org_donor_test';
const HASH = 'hash_donor_1';
const TRANSCRIPT =
  'Source: https://www.youtube.com/watch?v=abc\nPlatform: youtube\n\nHello transcript.';

interface SeedOverrides {
  org?: string;
  jobStatus?: 'completed' | 'skipped' | 'failed';
  jobLifecycle?: 'active' | 'trashed';
  metaLifecycle?: 'active' | 'trashed';
  metaTranscript?: string;
  metaStatus?: 'completed' | 'running';
}

async function seedDonorPair(
  t: T,
  overrides: SeedOverrides = {},
): Promise<{ jobId: Id<'videoLinkJobs'>; metaId: Id<'fileMetadata'> }> {
  return t.run(async (ctx) => {
    const org = overrides.org ?? ORG;
    const metaId = await ctx.db.insert('fileMetadata', {
      organizationId: org,
      storageId: `s3:${org}/donor-blob`,
      source: 'video_link',
      fileName: 'Test Video.txt',
      contentType: 'text/plain; charset=utf-8',
      size: TRANSCRIPT.length,
      uploadedBy: 'user_donor',
      transcript: overrides.metaTranscript ?? TRANSCRIPT,
      transcriptionStatus: overrides.metaStatus ?? 'completed',
      transcriptRagStatus: 'completed',
      ragStatus: 'completed',
      lifecycleStatus: overrides.metaLifecycle ?? 'active',
      statusChangedAt: Date.now(),
    });
    const jobId = await ctx.db.insert('videoLinkJobs', {
      organizationId: org,
      uploadedBy: 'user_donor',
      sourceUrl: 'https://www.youtube.com/watch?v=abc',
      sourceUrlHash: HASH,
      sourcePlatform: 'youtube',
      pastedToken: 'https://www.youtube.com/watch?v=abc',
      status: overrides.jobStatus ?? 'completed',
      statusChangedAt: Date.now(),
      lifecycleStatus: overrides.jobLifecycle ?? 'active',
      fileMetadataId: metaId,
      storageId: `s3:${org}/donor-blob`,
      videoTitle: 'Test Video',
    });
    return { jobId, metaId };
  });
}

function findDonor(t: T, org = ORG, now = Date.now()) {
  return t.run(async (ctx) => findReusableTranscriptDonor(ctx, org, HASH, now));
}

describe('findReusableTranscriptDonor', () => {
  it('finds the completed donor for (org, hash)', async () => {
    const t = convexTest(schema, modules);
    const { metaId } = await seedDonorPair(t);

    const donor = await findDonor(t);

    expect(donor).not.toBeNull();
    expect(donor?.meta._id).toBe(metaId);
    expect(donor?.meta.transcript).toBe(TRANSCRIPT);
  });

  it('finds a donor whose chip was removed (skipped job, surviving row)', async () => {
    // The remove→re-add case: cancel flips the job to skipped and deletes
    // the blob, but the completed fileMetadata row (with transcript text)
    // survives — it must qualify as a donor.
    const t = convexTest(schema, modules);
    const { metaId } = await seedDonorPair(t, { jobStatus: 'skipped' });

    const donor = await findDonor(t);

    expect(donor?.meta._id).toBe(metaId);
  });

  it('ignores donors without a completed transcript', async () => {
    const t = convexTest(schema, modules);
    await seedDonorPair(t, { metaStatus: 'running' });
    expect(await findDonor(t)).toBeNull();

    const t2 = convexTest(schema, modules);
    await seedDonorPair(t2, { metaTranscript: '' });
    expect(await findDonor(t2)).toBeNull();
  });

  it('ignores donors older than the reuse window', async () => {
    const t = convexTest(schema, modules);
    await seedDonorPair(t);

    const farFuture = Date.now() + TRANSCRIPT_REUSE_MAX_AGE_MS + 60_000;
    expect(await findDonor(t, ORG, farFuture)).toBeNull();
  });

  it('never crosses organizations', async () => {
    const t = convexTest(schema, modules);
    await seedDonorPair(t);

    expect(await findDonor(t, 'org_other')).toBeNull();
  });

  it('skips trashed rows', async () => {
    const t = convexTest(schema, modules);
    await seedDonorPair(t, { jobLifecycle: 'trashed' });
    expect(await findDonor(t)).toBeNull();

    const t2 = convexTest(schema, modules);
    await seedDonorPair(t2, { metaLifecycle: 'trashed' });
    expect(await findDonor(t2)).toBeNull();
  });

  it('returns the newest qualifying donor', async () => {
    const t = convexTest(schema, modules);
    await seedDonorPair(t, { metaTranscript: `${TRANSCRIPT} v1` });
    const { metaId: newerMetaId } = await seedDonorPair(t, {
      metaTranscript: `${TRANSCRIPT} v2`,
    });

    const donor = await findDonor(t);

    expect(donor?.meta._id).toBe(newerMetaId);
  });
});

async function seedCloneJob(
  t: T,
  status: 'indexing' | 'skipped',
): Promise<Id<'videoLinkJobs'>> {
  return t.run(async (ctx) =>
    ctx.db.insert('videoLinkJobs', {
      organizationId: ORG,
      threadId: 'thread_clone_1',
      uploadedBy: 'user_repaster',
      sourceUrl: 'https://www.youtube.com/watch?v=abc',
      sourceUrlHash: HASH,
      sourcePlatform: 'youtube',
      pastedToken: 'youtube.com/watch?v=abc',
      status,
      statusChangedAt: Date.now(),
      lifecycleStatus: 'active',
      videoTitle: 'Test Video',
    }),
  );
}

describe('finalizeClonedTranscript', () => {
  it('lands the verbatim transcript and completes the job', async () => {
    const t = convexTest(schema, modules);
    const jobId = await seedCloneJob(t, 'indexing');

    const fileMetadataId = await t.mutation(
      internal.video_links.internal_mutations.finalizeClonedTranscript,
      {
        jobId,
        storageId: `s3:${ORG}/clone-blob`,
        organizationId: ORG,
        transcript: TRANSCRIPT,
        fileName: 'Test Video.txt',
        fileSize: TRANSCRIPT.length,
        transcriptionDurationSec: 12,
      },
    );

    expect(fileMetadataId).not.toBeNull();
    const row = await t.run(async (ctx) =>
      ctx.db.get(fileMetadataId as Id<'fileMetadata'>),
    );
    // Verbatim — the donor text already carries the provenance header;
    // a doubled header here means the finalizer re-prepended it.
    expect(row?.transcript).toBe(TRANSCRIPT);
    expect(row?.source).toBe('video_link');
    expect(row?.contentType).toBe('text/plain; charset=utf-8');
    expect(row?.ragStatus).toBe('queued');
    expect(row?.transcriptRagStatus).toBe('queued');
    expect(row?.transcriptionStatus).toBe('completed');
    expect(row?.threadId).toBe('thread_clone_1');
    expect(row?.uploadedBy).toBe('user_repaster');

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job?.status).toBe('completed');
    expect(job?.fileMetadataId).toBe(fileMetadataId);
    expect(job?.storageId).toBe(`s3:${ORG}/clone-blob`);
  });

  it('bails and reaps the blob when cancel raced the clone', async () => {
    const t = convexTest(schema, modules);
    const jobId = await seedCloneJob(t, 'skipped');

    const result = await t.mutation(
      internal.video_links.internal_mutations.finalizeClonedTranscript,
      {
        jobId,
        storageId: `s3:${ORG}/orphan-blob`,
        organizationId: ORG,
        transcript: TRANSCRIPT,
        fileName: 'Test Video.txt',
        fileSize: TRANSCRIPT.length,
      },
    );

    expect(result).toBeNull();
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query('fileMetadata')
        .filter((q) => q.eq(q.field('organizationId'), ORG))
        .collect(),
    );
    expect(rows).toHaveLength(0);
    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job?.status).toBe('skipped');
    expect(vi.mocked(deleteOrgBlobInMutation)).toHaveBeenCalledWith(
      expect.anything(),
      ORG,
      `s3:${ORG}/orphan-blob`,
      'video_links.finalizeClonedTranscript',
    );
  });
});
