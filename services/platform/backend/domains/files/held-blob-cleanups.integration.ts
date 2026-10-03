/**
 * Real Postgres and the object-store pin: the cleanup lanes #4110's sweep
 * left open delete bytes only when nothing holds them (`blobRefHeld`), or
 * hold a ref nothing else can name. Each lane used to delete a ref a task or
 * a document could still list:
 *
 *  - a video link's cleanup (cancel, retry, watchdog) and its 7-day unbound
 *    GC deleted the job's ref, which is its paster's own file row's ref — so
 *    the task door and the document door take it — and the GC dropped a
 *    file row a document had taken over;
 *  - the skill and automation bundle lanes delete their staged zip, whose
 *    upload intent the task, document and mail doors accepted whatever its
 *    purpose;
 *  - dropping a task's attachment trashed every unbound row of the ref,
 *    a product's image row included, and the release then took the bytes
 *    and the row the product still shows.
 *
 * Every write a user makes goes through the session doors; every verdict on
 * the bytes is a HEAD against the store.
 */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';
import { z } from 'zod';

import { encodeS3Ref } from '../../core/lib/storage/blob_ref.ts';
import {
  itestObjectStore,
  type RecordCheck,
  recordSkip,
} from '../../integration-lane-helpers.ts';
import {
  buildObjectKey,
  resolveObjectStore,
  s3DeleteObject,
  s3HeadObject,
  s3PutObject,
} from '../../lib/object-store.ts';
import { runReleaseRefsJob } from '../knowledge/release.ts';
import { ensureDefaultObjectStore } from '../object_storage/bootstrap.ts';
import { productImageId } from '../products/image-url.ts';
import { runVideoLinkWatchdog } from '../video_links/service.ts';

interface Actor {
  cookie: string;
  userId: string;
}

type SignUpMember = (label: string, role: string) => Promise<Actor>;

/** A 1×1 PNG: the product image door sniffs the bytes, never the header. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

const keyOf = (ref: string) => (ref.startsWith('s3:') ? ref.slice(3) : ref);

/**
 * One lane's org-scoped probe: its own admin uploader (so it neither spends
 * the shared user's upload budget nor depends on earlier lanes), a project
 * for its tasks, the doors it calls, and the bookkeeping its cleanup undoes.
 */
async function openProbe(
  sql: Sql,
  base: string,
  orgId: string,
  signUpMember: SignUpMember,
  label: string,
) {
  const objectStore = itestObjectStore();
  if (!objectStore) return null;
  const suffix = randomUUID().slice(0, 8);
  const slugRows = await sql<{ slug: string }[]>`
    SELECT "slug" FROM "organization" WHERE "id" = ${orgId} LIMIT 1
  `;
  const orgSlug = slugRows[0]?.slug ?? '';
  // A filtered run may not have run checkFiles, which seeds the default
  // store; keep a configured one intact so earlier lanes' blobs stay put.
  try {
    await resolveObjectStore(orgSlug);
  } catch {
    await ensureDefaultObjectStore(sql, {
      OBJECT_STORE_ENDPOINT: objectStore.endpoint,
      OBJECT_STORE_BUCKET: `itest-held-blob-${suffix}`,
      OBJECT_STORE_ACCESS_KEY: objectStore.accessKeyId,
      OBJECT_STORE_SECRET_KEY: objectStore.secretAccessKey,
    });
  }
  const store = await resolveObjectStore(orgSlug);
  const owner = await signUpMember(`${label}-${suffix}`, 'admin');
  const projectId = randomUUID();
  const now = Date.now();
  await sql`
    INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms,
                              updated_at_ms)
    VALUES (${projectId}, ${orgId}, ${`Held blob probe ${label}`},
            ${owner.userId}, ${now}, ${now})
  `;
  const refs: string[] = [];
  const productIds: string[] = [];
  const documentIds: string[] = [];

  const call = (method: string, route: string, body?: unknown) =>
    fetch(
      `${base}/api/app/${route}${route.includes('?') ? '&' : '?'}orgId=${orgId}`,
      {
        method,
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          cookie: owner.cookie,
          origin: base,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
  const jsonOf = async (response: Response): Promise<unknown> =>
    response.json().catch(() => null);
  const present = async (ref: string): Promise<boolean> =>
    (await s3HeadObject(store, keyOf(ref))) !== null;
  /** Bytes put straight into the org's store, as a server lane writes them. */
  const putBlob = async (text: string): Promise<string> => {
    const key = buildObjectKey(store, orgSlug);
    await s3PutObject(store, key, new TextEncoder().encode(text), 'text/plain');
    const ref = encodeS3Ref(key);
    refs.push(ref);
    return ref;
  };
  /** The byte lane (`POST files/upload`): an intent of `purpose`, no row. */
  const upload = async (purpose: string, text: string): Promise<string> => {
    const response = await fetch(
      `${base}/api/app/files/upload?orgId=${orgId}&purpose=${purpose}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          cookie: owner.cookie,
          origin: base,
        },
        body: text,
      },
    );
    const parsed = z
      .object({ storageId: z.string() })
      .safeParse(await jsonOf(response));
    if (!parsed.success) {
      throw new Error(`upload ${purpose}: ${response.status}`);
    }
    refs.push(parsed.data.storageId);
    return parsed.data.storageId;
  };
  /** The task door with `ref` as the new task's attachment. */
  const attach = async (ref: string, name: string) => {
    const response = await call('POST', 'tasks', {
      projectId,
      title: `Held blob probe: ${name}`,
      attachments: [
        {
          fileId: ref,
          fileName: `${name}.txt`,
          fileType: 'text/plain',
          fileSize: 1,
        },
      ],
    });
    const parsed = z
      .object({ taskId: z.string() })
      .safeParse(await jsonOf(response));
    return {
      status: response.status,
      taskId: parsed.success ? parsed.data.taskId : null,
    };
  };
  /** The document door that takes the caller's upload over as a document. */
  const bindDocument = async (ref: string, name: string) => {
    const response = await call('POST', 'documents/from-blob-upload', {
      storageRef: ref,
      fileName: `${name}.txt`,
      contentType: 'text/plain',
    });
    const parsed = z
      .object({ documentId: z.string() })
      .safeParse(await jsonOf(response));
    if (parsed.success) documentIds.push(parsed.data.documentId);
    return response.status;
  };
  const listed = async (taskId: string | null, ref: string) => {
    if (taskId === null) return false;
    const rows = await sql<{ listed: boolean }[]>`
      SELECT coalesce(attachments, '[]'::jsonb)
             @> jsonb_build_array(jsonb_build_object('fileId', ${ref}::text))
             AS listed
      FROM app.tasks WHERE id = ${taskId}
    `;
    return rows[0]?.listed ?? false;
  };
  /** A file row's lifecycle, or `gone`. */
  const rowState = async (fileId: string): Promise<string> => {
    const rows = await sql<{ lifecycle: string | null }[]>`
      SELECT lifecycle_status AS lifecycle FROM app.file_metadata
      WHERE id = ${fileId}
    `;
    const row = rows[0];
    return row === undefined ? 'gone' : (row.lifecycle ?? 'active');
  };
  const close = async () => {
    // Leave no probe bytes or rows behind; the project cascades its tasks.
    for (const ref of refs) {
      await s3DeleteObject(store, keyOf(ref)).catch((error: unknown) =>
        console.warn('[itest] held-blob probe cleanup failed:', error),
      );
    }
    await sql`DELETE FROM app.video_link_jobs WHERE org_id = ${orgId}
      AND storage_ref = ANY(${refs})`;
    await sql`DELETE FROM app.products WHERE id = ANY(${productIds})`;
    await sql`DELETE FROM app.documents WHERE org_id = ${orgId}
      AND (id = ANY(${documentIds}) OR file_ref = ANY(${refs}))`;
    await sql`DELETE FROM app.file_metadata WHERE org_id = ${orgId}
      AND storage_ref = ANY(${refs})`;
    await sql`DELETE FROM app.upload_intents WHERE org_id = ${orgId}
      AND s3_ref = ANY(${refs})`;
    await sql`DELETE FROM app.projects WHERE id = ${projectId}`;
  };
  return {
    suffix,
    owner,
    refs,
    productIds,
    call,
    jsonOf,
    present,
    putBlob,
    upload,
    attach,
    bindDocument,
    listed,
    rowState,
    close,
  };
}

/** Recorded, never thrown: a thrown lane truncates every later lane. */
function recordThrow(record: RecordCheck, lane: string, error: unknown) {
  record(
    `${lane} lane runs to completion`,
    false,
    `threw ${error instanceof Error ? error.message : String(error)}`,
  );
}

/**
 * A video link's ref is its paster's own transcript row's ref, handed to the
 * chip as `storageId`: the task door (file-row arm) and the document door
 * both take it. The cleanup (cancel, retry, watchdog) and the unbound GC
 * must leave the bytes to whatever still holds them, and the GC must leave
 * a row a document took over — while an unheld job still goes, row and all.
 */
export async function checkVideoLinkHeldBlobs(
  sql: Sql,
  base: string,
  ctx: { orgId: string },
  signUpMember: SignUpMember,
  record: RecordCheck,
): Promise<void> {
  const p = await openProbe(sql, base, ctx.orgId, signUpMember, 'video-held');
  if (p === null) {
    recordSkip(
      record,
      'video-link held blobs',
      'no ITEST_S3_ENDPOINT — S3 lanes not exercised in this run',
    );
    return;
  }
  const { orgId } = ctx;
  const GC_AGE_MS = 8 * 24 * 60 * 60 * 1000;
  /** A video-link job over its transcript row, as the finalizers leave it. */
  const videoJob = async (args: {
    label: string;
    status: string;
    fileStatus: string;
    aged?: boolean;
  }) => {
    const text = `video transcript probe ${args.label}`;
    const ref = await p.putBlob(text);
    const at = Date.now() - (args.aged === true ? GC_AGE_MS : 0);
    const files = await sql<{ id: string }[]>`
      INSERT INTO app.file_metadata (
        org_id, storage_ref, source, file_name, content_type, size,
        uploaded_by, transcript, transcription_status, created_at_ms
      ) VALUES (
        ${orgId}, ${ref}, 'video_link', ${`${args.label}.txt`},
        'text/plain; charset=utf-8', ${text.length}, ${p.owner.userId},
        ${text}, ${args.fileStatus}, ${at}
      ) RETURNING id
    `;
    const fileId = files[0]?.id ?? '';
    const jobs = await sql<{ id: string }[]>`
      INSERT INTO app.video_link_jobs (
        org_id, uploaded_by, source_url, source_url_hash, source_platform,
        pasted_token, status, status_changed_at_ms, storage_ref,
        file_metadata_id, lifecycle_status, created_at_ms
      ) VALUES (
        ${orgId}, ${p.owner.userId},
        ${`https://example.test/held-${p.suffix}-${args.label}`},
        ${`held-${p.suffix}-${args.label}`}, 'youtube',
        ${`held-${args.label}`}, ${args.status}, ${at}, ${ref}, ${fileId},
        'active', ${at}
      ) RETURNING id
    `;
    return { jobId: jobs[0]?.id ?? '', fileId, ref };
  };
  const cancel = async (jobId: string) =>
    (await p.call('POST', `video-links/${jobId}/cancel`)).status;
  const jobGone = async (jobId: string) =>
    (
      await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM app.video_link_jobs WHERE id = ${jobId}
      `
    )[0]?.n === 0;

  try {
    // The cleanup: a cancelled chip whose ref a task lists, or whose row a
    // document took over, keeps its bytes; an unheld one is reclaimed.
    const taskHeld = await videoJob({
      label: 'cancel-task',
      status: 'failed',
      fileStatus: 'failed',
    });
    const taskAttach = await p.attach(taskHeld.ref, 'cancel-task');
    const taskCancel = await cancel(taskHeld.jobId);
    const taskKept = await p.present(taskHeld.ref);
    const taskListed = await p.listed(taskAttach.taskId, taskHeld.ref);
    const taskRow = await p.rowState(taskHeld.fileId);
    const docHeld = await videoJob({
      label: 'cancel-document',
      status: 'failed',
      fileStatus: 'failed',
    });
    const docBind = await p.bindDocument(docHeld.ref, 'cancel-document');
    const docCancel = await cancel(docHeld.jobId);
    const docKept = await p.present(docHeld.ref);
    const docRow = await p.rowState(docHeld.fileId);
    const done = await videoJob({
      label: 'cancel-completed',
      status: 'completed',
      fileStatus: 'completed',
    });
    const doneCancel = await cancel(done.jobId);
    const doneKept = await p.present(done.ref);
    const doneRow = await p.rowState(done.fileId);
    const unheld = await videoJob({
      label: 'cancel-unheld',
      status: 'failed',
      fileStatus: 'failed',
    });
    const unheldCancel = await cancel(unheld.jobId);
    const unheldGone = !(await p.present(unheld.ref));
    const unheldRow = await p.rowState(unheld.fileId);
    record(
      'a cancelled video link keeps the bytes a task or a document holds, and reclaims an unheld one (#4110)',
      taskAttach.status === 200 &&
        taskCancel === 200 &&
        taskKept &&
        taskListed &&
        docBind === 200 &&
        docCancel === 200 &&
        docKept &&
        docRow === 'active' &&
        doneCancel === 200 &&
        doneKept &&
        doneRow === 'active' &&
        unheldCancel === 200 &&
        unheldGone &&
        unheldRow === 'gone',
      `task: attach=${taskAttach.status} cancel=${taskCancel} kept=${taskKept} listed=${taskListed} row=${taskRow} (want 200/200/true/true, row gone); document: bind=${docBind} cancel=${docCancel} kept=${docKept} row=${docRow} (want 200/200/true/active); completed transcript: cancel=${doneCancel} kept=${doneKept} row=${doneRow} (want 200/true/active — the row the cleanup keeps holds its bytes); unheld: cancel=${unheldCancel} gone=${unheldGone} row=${unheldRow} (want 200/true/gone)`,
    );

    // The 7-day unbound GC: the same holders keep the bytes, a document's
    // row stays the document's, and an unheld job goes with its row and
    // bytes.
    const gcTask = await videoJob({
      label: 'gc-task',
      status: 'completed',
      fileStatus: 'completed',
      aged: true,
    });
    const gcAttach = await p.attach(gcTask.ref, 'gc-task');
    const gcDoc = await videoJob({
      label: 'gc-document',
      status: 'completed',
      fileStatus: 'completed',
      aged: true,
    });
    const gcBind = await p.bindDocument(gcDoc.ref, 'gc-document');
    const gcUnheld = await videoJob({
      label: 'gc-unheld',
      status: 'skipped',
      fileStatus: 'completed',
      aged: true,
    });
    await runVideoLinkWatchdog(sql);
    const gcTaskKept = await p.present(gcTask.ref);
    const gcTaskListed = await p.listed(gcAttach.taskId, gcTask.ref);
    const gcDocKept = await p.present(gcDoc.ref);
    const gcDocRow = await p.rowState(gcDoc.fileId);
    const gcUnheldGone = !(await p.present(gcUnheld.ref));
    const gcUnheldRow = await p.rowState(gcUnheld.fileId);
    const jobsGone = [
      await jobGone(gcTask.jobId),
      await jobGone(gcDoc.jobId),
      await jobGone(gcUnheld.jobId),
    ];
    record(
      'the unbound video-link GC keeps the bytes a task or a document holds and a document’s row, and reclaims an unheld job (#4110)',
      gcAttach.status === 200 &&
        gcTaskKept &&
        gcTaskListed &&
        gcBind === 200 &&
        gcDocKept &&
        gcDocRow === 'active' &&
        gcUnheldGone &&
        gcUnheldRow === 'gone' &&
        jobsGone.every(Boolean),
      `task: attach=${gcAttach.status} kept=${gcTaskKept} listed=${gcTaskListed} (want 200/true/true); document: bind=${gcBind} kept=${gcDocKept} row=${gcDocRow} (want 200/true/active); unheld: gone=${gcUnheldGone} row=${gcUnheldRow} (want true/gone); jobs reaped=${jobsGone.join('/')} (want true each)`,
    );
  } catch (error) {
    recordThrow(record, 'video-link held blobs', error);
  } finally {
    await p.close();
  }
}

/**
 * A staged skill or automation bundle is consumed by its own lane, which
 * deletes the zip on every path. Its upload intent must therefore prove
 * nothing to the doors that bind the caller's uploads (task, document,
 * mail): an intent is consumed by the lane its purpose names. A file upload
 * still binds there, and the bundle lanes still reclaim their zip.
 */
export async function checkStagedBundlesUnnameable(
  sql: Sql,
  base: string,
  ctx: { orgId: string },
  signUpMember: SignUpMember,
  record: RecordCheck,
): Promise<void> {
  const p = await openProbe(sql, base, ctx.orgId, signUpMember, 'bundle-held');
  if (p === null) {
    recordSkip(
      record,
      'staged bundles',
      'no ITEST_S3_ENDPOINT — S3 lanes not exercised in this run',
    );
    return;
  }
  const lanes = {
    skill_bundle: 'skills/upload',
    automation_bundle: 'automations/upload',
  } as const;
  const consume = async (purpose: keyof typeof lanes, storageId: string) =>
    (await p.call('POST', lanes[purpose], { storageId })).status;

  try {
    const verdicts: string[] = [];
    let refusedAndReclaimed = true;
    for (const purpose of ['skill_bundle', 'automation_bundle'] as const) {
      // Not a zip: the lane reads it, refuses it and deletes it — the same
      // `finally` a good bundle meets.
      const viaTask = await p.upload(purpose, `not a zip: ${purpose} task`);
      const attached = await p.attach(viaTask, `${purpose}-task`);
      const taskConsumed = await consume(purpose, viaTask);
      const taskKept = await p.present(viaTask);
      const taskListed = await p.listed(attached.taskId, viaTask);
      const viaDocument = await p.upload(purpose, `not a zip: ${purpose} doc`);
      const bound = await p.bindDocument(viaDocument, `${purpose}-document`);
      const docConsumed = await consume(purpose, viaDocument);
      const docKept = await p.present(viaDocument);
      const alone = await p.upload(purpose, `not a zip: ${purpose} alone`);
      const aloneConsumed = await consume(purpose, alone);
      const aloneGone = !(await p.present(alone));
      refusedAndReclaimed &&=
        attached.status === 403 &&
        !taskListed &&
        bound !== 200 &&
        !taskKept &&
        !docKept &&
        aloneGone;
      verdicts.push(
        `${purpose}: attach=${attached.status} (want 403) then upload=${taskConsumed} kept=${taskKept} listed=${taskListed}; document bind=${bound} (want refused) then upload=${docConsumed} kept=${docKept}; alone: upload=${aloneConsumed} reclaimed=${aloneGone} (want true)`,
      );
    }
    // A file upload still binds through the same proof.
    const file = await p.upload('file', 'a file upload still binds');
    const fileAttach = await p.attach(file, 'file-upload');
    const fileBind = await p.bindDocument(file, 'file-upload');
    record(
      'a staged bundle’s upload can be attached or bound by nothing but its own lane, which reclaims it (#4110)',
      refusedAndReclaimed && fileAttach.status === 200 && fileBind === 200,
      `${verdicts.join('; ')}; file upload: attach=${fileAttach.status} bind=${fileBind} (want 200/200)`,
    );
  } catch (error) {
    recordThrow(record, 'staged bundles', error);
  } finally {
    await p.close();
  }
}

/**
 * Dropping a task's attachment releases the ref: the task's own unbound
 * rows are trashed, and the release job takes the bytes (and reaps the
 * trashed rows) once nothing live names them. A product's image row is the
 * product's, not the task's: when a task let go of an image's ref, the
 * release took the bytes and the row the product still shows.
 */
export async function checkTaskReleaseKeepsProductImage(
  sql: Sql,
  base: string,
  ctx: { orgId: string },
  signUpMember: SignUpMember,
  record: RecordCheck,
): Promise<void> {
  const p = await openProbe(sql, base, ctx.orgId, signUpMember, 'retire-held');
  if (p === null) {
    recordSkip(
      record,
      'task release and product images',
      'no ITEST_S3_ENDPOINT — S3 lanes not exercised in this run',
    );
    return;
  }
  const { orgId } = ctx;
  /** Drop every attachment of `taskId`, then run its release job now. */
  const dropAndRelease = async (taskId: string | null, ref: string) => {
    const dropped =
      taskId === null
        ? 0
        : (await p.call('POST', `tasks/${taskId}`, { attachments: [] })).status;
    await runReleaseRefsJob(sql, { organizationId: orgId, refs: [ref] });
    return dropped;
  };

  try {
    const response = await fetch(
      `${base}/api/app/products/images?orgId=${orgId}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'image/png',
          cookie: p.owner.cookie,
          origin: base,
        },
        body: PNG,
      },
    );
    const uploaded = z
      .object({ imageUrl: z.string() })
      .safeParse(await p.jsonOf(response));
    if (!uploaded.success) throw new Error(`image: ${response.status}`);
    const fileId = productImageId(uploaded.data.imageUrl, orgId) ?? '';
    const created = z.object({ productId: z.string() }).safeParse(
      await p.jsonOf(
        await p.call('POST', 'products', {
          name: `Retire probe ${p.suffix}`,
          imageUrl: uploaded.data.imageUrl,
        }),
      ),
    );
    if (!created.success) throw new Error('product create failed');
    p.productIds.push(created.data.productId);
    const read = z
      .object({ file: z.object({ storageRef: z.string() }) })
      .safeParse(await p.jsonOf(await p.call('GET', `files/${fileId}`)));
    if (!read.success) throw new Error('files door refused the image');
    const imageRef = read.data.file.storageRef;
    p.refs.push(imageRef);
    const imageTask = await p.attach(imageRef, 'product-image');
    const imageDrop = await dropAndRelease(imageTask.taskId, imageRef);
    const imageRow = await p.rowState(fileId);
    const imageKept = await p.present(imageRef);
    const served = (await p.call('GET', `products/images/${fileId}`)).status;

    // The control: the task's own upload still goes once the task drops it.
    const own = await p.upload('file', 'a task’s own attachment');
    const ownTask = await p.attach(own, 'own-attachment');
    const ownDrop = await dropAndRelease(ownTask.taskId, own);
    const ownGone = !(await p.present(own));
    record(
      'dropping a task’s attachment leaves a product’s image to the product, and still releases the task’s own upload (#4110)',
      imageTask.status === 200 &&
        imageDrop === 200 &&
        imageRow === 'active' &&
        imageKept &&
        served === 200 &&
        ownTask.status === 200 &&
        ownDrop === 200 &&
        ownGone,
      `product image: attach=${imageTask.status} drop=${imageDrop} row=${imageRow} kept=${imageKept} served=${served} (want 200/200/active/true/200); own upload: attach=${ownTask.status} drop=${ownDrop} released=${ownGone} (want 200/200/true)`,
    );
  } catch (error) {
    recordThrow(record, 'task release and product images', error);
  } finally {
    await p.close();
  }
}
