/**
 * The composer's video chips over the native Hono routes and real Postgres
 * (#3704, #3720). A URL pasted in chat A, then in chat B, then in A again
 * reuses A's unsent job; a Remove the org-member gate refuses leaves the job
 * queued and answers the code the chip's toast reads, then succeeds once the
 * membership is back; a worker result held across that cancel lands nothing.
 *
 * No job runs. Every `video.ingest` this lane enqueues is held a day out by
 * a trigger that lives only while the lane does, so the in-process worker
 * never takes one: nothing resolves, downloads or spawns, and each paste
 * sees the rows the previous one left.
 */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';
import { z } from 'zod';

import { insertSyntheticFileMetadata, runVideoIngestJob } from './service.ts';

const jobIdBody = z.object({ jobId: z.string() });
const refusalBody = z.object({ error: z.string(), message: z.string() });
const listBody = z.object({
  jobs: z.array(z.object({ jobId: z.string(), displayStatus: z.string() })),
});

interface JobState {
  threadId: string | null;
  status: string;
  pastedToken: string;
  sourceUrlHash: string;
}

export async function checkVideoLinkComposerChips(
  sql: Sql,
  base: string,
  ctx: { cookie: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  const orgId = `itest-video-chips-${suffix}`;
  const memberId = randomUUID();
  const threadA = `itest-video-chips-a-${suffix}`;
  const threadB = `itest-video-chips-b-${suffix}`;
  const url = `https://www.youtube.com/watch?v=chips${suffix}`;
  const now = Date.now();

  // A private organization: its in-flight cap, its jobs and the membership
  // this lane disables are nobody else's.
  await sql`
    INSERT INTO "organization" ("id", "name", "slug", "createdAt")
    VALUES (${orgId}, 'Video chips', ${orgId}, now())
  `;
  await sql`
    INSERT INTO "member" ("id", "organizationId", "userId", "role", "createdAt")
    VALUES (${memberId}, ${orgId}, ${ctx.userId}, 'member', now())
  `;
  for (const threadId of [threadA, threadB]) {
    await sql`
      INSERT INTO app.threads (id, org_id, user_id, kind, created_at_ms,
                               updated_at_ms)
      VALUES (${threadId}, ${orgId}, ${ctx.userId}, 'chat', ${now}, ${now})
    `;
    await sql`
      INSERT INTO app.thread_metadata (
        thread_id, org_id, user_id, chat_type, status, created_at_ms
      ) VALUES (${threadId}, ${orgId}, ${ctx.userId}, 'assistant', 'active',
                ${now})
    `;
  }
  await sql`
    CREATE OR REPLACE FUNCTION app.itest_hold_video_ingest() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      NEW.start_after := now() + interval '1 day';
      RETURN NEW;
    END
    $$
  `;
  await sql`DROP TRIGGER IF EXISTS itest_hold_video_ingest ON pgboss.job`;
  await sql`
    CREATE TRIGGER itest_hold_video_ingest BEFORE INSERT ON pgboss.job
    FOR EACH ROW WHEN (NEW.name = 'video.ingest')
    EXECUTE FUNCTION app.itest_hold_video_ingest()
  `;

  const send = (route: string, body?: unknown): Promise<Response> =>
    fetch(`${base}/api/app/video-links${route}?orgId=${orgId}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: ctx.cookie,
        origin: base,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const paste = async (
    threadId: string,
    pasted: string,
  ): Promise<{ status: number; jobId: string }> => {
    const res = await send('/ingest', {
      url: pasted,
      pastedToken: pasted,
      threadId,
    });
    const parsed = jobIdBody.safeParse(await res.json().catch(() => null));
    return {
      status: res.status,
      jobId: parsed.success ? parsed.data.jobId : '',
    };
  };
  const refusal = async (
    res: Response,
  ): Promise<{ status: number; code: string; hasMessage: boolean }> => {
    const parsed = refusalBody.safeParse(await res.json().catch(() => null));
    return {
      status: res.status,
      code: parsed.success ? parsed.data.error : '',
      hasMessage: parsed.success && parsed.data.message.length > 0,
    };
  };
  const jobState = async (jobId: string): Promise<JobState | null> => {
    const rows = await sql<JobState[]>`
      SELECT thread_id AS "threadId", status, pasted_token AS "pastedToken",
             source_url_hash AS "sourceUrlHash"
      FROM app.video_link_jobs WHERE id = ${jobId}
    `;
    return rows[0] ?? null;
  };
  const heldIngests = async (): Promise<{ total: number; held: number }> => {
    const rows = await sql<{ total: number; held: number }[]>`
      SELECT count(*)::int AS total,
             count(*) FILTER (
               WHERE start_after > now() + interval '23 hours'
             )::int AS held
      FROM pgboss.job j
      JOIN app.video_link_jobs v ON v.id = j.data ->> 'jobId'
      WHERE j.name = 'video.ingest' AND v.org_id = ${orgId}
    `;
    return rows[0] ?? { total: 0, held: 0 };
  };

  try {
    // Same chat, consecutive pastes: a tracking/fragment variant of the URL
    // is the same video and replaces the token the send will strip.
    const first = await paste(threadA, url);
    const variant = `${url}&si=itest#t=1`;
    const again = await paste(threadA, variant);
    const firstRow = await jobState(first.jobId);
    record(
      'video links: a second paste in the same chat reuses its job',
      first.status === 200 &&
        again.status === 200 &&
        again.jobId === first.jobId &&
        firstRow?.pastedToken === variant,
      `first=${first.status}/${first.jobId} again=${again.status}/${again.jobId} token=${firstRow?.pastedToken ?? 'none'}`,
    );

    // Another chat: its own job.
    const other = await paste(threadB, url);
    const otherRow = await jobState(other.jobId);
    record(
      'video links: the same URL in another chat starts its own job',
      other.status === 200 &&
        other.jobId !== first.jobId &&
        otherRow?.threadId === threadB,
      `B=${other.status}/${other.jobId} thread=${otherRow?.threadId ?? 'none'}`,
    );

    // Back in chat A: chat B's newer job must not hide A's (#3704).
    const back = await paste(threadA, url);
    const unsentInA = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM app.video_link_jobs
      WHERE org_id = ${orgId} AND thread_id = ${threadA}
        AND source_url_hash = ${firstRow?.sourceUrlHash ?? ''}
        AND message_bound_at_ms IS NULL
    `;
    const listA = listBody.safeParse(
      await (await send(`/thread/${threadA}`)).json().catch(() => null),
    );
    const ingests = await heldIngests();
    record(
      'video links: after the URL was pasted in chat B, chat A keeps its one job',
      back.status === 200 &&
        back.jobId === first.jobId &&
        unsentInA[0]?.count === 1 &&
        listA.success &&
        listA.data.jobs.length === 1 &&
        ingests.total === 2 &&
        ingests.held === 2,
      `A again=${back.status}/${back.jobId} (want ${first.jobId}), unsent in A=${unsentInA[0]?.count} (want 1), chips in A=${listA.success ? listA.data.jobs.length : 'unread'} (want 1), video.ingest jobs=${ingests.total} held=${ingests.held} (want 2/2)`,
    );

    // A Remove and a Try again the org-member gate refuses: the job stays
    // where it was, and the answer carries the code and words the chip's
    // toast reads.
    await sql`UPDATE "member" SET "role" = 'disabled' WHERE "id" = ${memberId}`;
    const refusedCancel = await refusal(
      await send(`/${first.jobId}/cancel`, {}),
    );
    const refusedRetry = await refusal(await send(`/${other.jobId}/retry`, {}));
    await sql`UPDATE "member" SET "role" = 'member' WHERE "id" = ${memberId}`;
    const afterRefusal = await jobState(first.jobId);
    record(
      'video links: a refused Remove keeps the job queued and says why',
      refusedCancel.status === 403 &&
        refusedCancel.code === 'ORG_FORBIDDEN' &&
        refusedCancel.hasMessage &&
        refusedRetry.status === 403 &&
        refusedRetry.code === 'ORG_FORBIDDEN' &&
        afterRefusal?.status === 'queued',
      `cancel=${refusedCancel.status}/${refusedCancel.code} message=${refusedCancel.hasMessage}, retry=${refusedRetry.status}/${refusedRetry.code}, job=${afterRefusal?.status ?? 'gone'} (want queued)`,
    );

    // The video domain's own refusal for a live job's Try again.
    const liveRetry = await refusal(await send(`/${other.jobId}/retry`, {}));
    record(
      'video links: Try again on a live job answers its video-link code',
      liveRetry.status === 409 && liveRetry.code === 'notRetryable',
      `retry=${liveRetry.status}/${liveRetry.code} (want 409/notRetryable)`,
    );

    // A worker already storing the transcript when Remove lands: the job is
    // `indexing` with its blob recorded. The member is back, so the cancel
    // goes through; the finalizer the worker was about to run, and a
    // redelivered ingest job, then write nothing.
    const lateBlob = `s3:${orgId}/late-transcript`;
    await sql`
      UPDATE app.video_link_jobs
      SET status = 'indexing', status_changed_at_ms = ${Date.now()},
          storage_ref = ${lateBlob}
      WHERE id = ${first.jobId}
    `;
    const cancel = await send(`/${first.jobId}/cancel`, {});
    const afterCancel = await jobState(first.jobId);
    const late = await insertSyntheticFileMetadata(sql, {
      jobId: first.jobId,
      storageId: lateBlob,
      transcript: 'A transcript that arrived after the Remove.',
      fileSize: 44,
      videoTitle: 'Late result',
      videoDurationSec: 3,
      sourceUrl: url,
      sourcePlatform: 'youtube',
      transcriptSource: 'captions_human',
      threadId: threadA,
      organizationId: orgId,
      uploadedBy: ctx.userId,
    });
    await runVideoIngestJob(sql, { jobId: first.jobId });
    const final = await jobState(first.jobId);
    const files = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM app.file_metadata
      WHERE org_id = ${orgId}
    `;
    const listAfter = listBody.safeParse(
      await (await send(`/thread/${threadA}`)).json().catch(() => null),
    );
    const chipA = listAfter.success
      ? listAfter.data.jobs.find((job) => job.jobId === first.jobId)
      : undefined;
    record(
      'video links: Remove succeeds once allowed, and a held worker result lands nothing',
      cancel.status === 200 &&
        afterCancel?.status === 'skipped' &&
        late === null &&
        final?.status === 'skipped' &&
        files[0]?.count === 0 &&
        chipA?.displayStatus === 'skipped',
      `cancel=${cancel.status} job=${afterCancel?.status ?? 'gone'}→${final?.status ?? 'gone'} (want skipped), finalizer=${late ?? 'null'} (want null), file rows=${files[0]?.count} (want 0), chip=${chipA?.displayStatus ?? 'missing'} (want skipped)`,
    );
  } finally {
    await sql`DROP TRIGGER IF EXISTS itest_hold_video_ingest ON pgboss.job`;
    await sql`DROP FUNCTION IF EXISTS app.itest_hold_video_ingest()`;
    await sql`
      DELETE FROM pgboss.job
      WHERE name = 'video.ingest'
        AND data ->> 'jobId' IN (
          SELECT id FROM app.video_link_jobs WHERE org_id = ${orgId}
        )
    `;
    await sql`DELETE FROM app.file_metadata WHERE org_id = ${orgId}`;
    await sql`DELETE FROM app.video_link_jobs WHERE org_id = ${orgId}`;
    await sql`DELETE FROM app.thread_metadata WHERE org_id = ${orgId}`;
    await sql`DELETE FROM app.threads WHERE org_id = ${orgId}`;
    await sql`DELETE FROM "member" WHERE "organizationId" = ${orgId}`;
    await sql`DELETE FROM "organization" WHERE "id" = ${orgId}`;
  }
}
