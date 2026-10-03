/**
 * Real Postgres and the object-store pin: `POST /api/app/files/reject-blob`
 * reclaims only bytes nothing holds (#4104). The reclaim proved "never bound"
 * by consuming the caller's open upload intent and asked about file rows
 * alone, while the task door, the document multi-bind and the outbound-mail
 * door bind WITHOUT consuming (they stamp `bound_at_ms`). So an upload
 * attached to a task and then rejected lost its bytes, and the card kept
 * listing a file every run start met as missing. Every reclaim here goes
 * through the session door; every verdict on the bytes is a HEAD against the
 * store.
 */
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';

import {
  itestObjectStore,
  type RecordCheck,
  recordSkip,
} from '../../integration-lane-helpers.ts';
import {
  resolveObjectStore,
  s3DeleteObject,
  s3HeadObject,
} from '../../lib/object-store.ts';
import { ensureDefaultObjectStore } from '../object_storage/bootstrap.ts';
import { firstForeignUpload, ownsUploadedBlob } from './upload-intents.ts';

interface Actor {
  cookie: string;
  userId: string;
}

const rejected = z.object({ deleted: z.boolean() });

export async function checkRejectedUploadReclaim(
  sql: Sql,
  base: string,
  ctx: { orgId: string },
  signUpMember: (label: string, role: string) => Promise<Actor>,
  record: RecordCheck,
): Promise<void> {
  const objectStore = itestObjectStore();
  if (!objectStore) {
    recordSkip(
      record,
      'rejected-upload reclaim',
      'no ITEST_S3_ENDPOINT — S3 lanes not exercised in this run',
    );
    return;
  }
  const { orgId } = ctx;
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
      OBJECT_STORE_BUCKET: `itest-reject-blob-${suffix}`,
      OBJECT_STORE_ACCESS_KEY: objectStore.accessKeyId,
      OBJECT_STORE_SECRET_KEY: objectStore.secretAccessKey,
    });
  }
  const store = await resolveObjectStore(orgSlug);
  // Its own uploader and member, so the lane neither spends the shared
  // user's upload budget nor depends on what earlier lanes left in it.
  const owner = await signUpMember(`reject-blob-owner-${suffix}`, 'admin');
  const member = await signUpMember(`reject-blob-member-${suffix}`, 'member');
  const projectId = randomUUID();
  const now = Date.now();
  await sql`
    INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms,
                              updated_at_ms)
    VALUES (${projectId}, ${orgId}, 'Rejected upload probe', ${owner.userId},
            ${now}, ${now})
  `;

  const post = (actor: Actor, route: string, body: unknown) =>
    fetch(`${base}/api/app/${route}?orgId=${orgId}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: actor.cookie,
        origin: base,
      },
      body: JSON.stringify(body),
    });
  const keyOf = (ref: string) => (ref.startsWith('s3:') ? ref.slice(3) : ref);
  const present = async (ref: string): Promise<boolean> =>
    (await s3HeadObject(store, keyOf(ref))) !== null;
  const refs: string[] = [];
  /** The byte lane (`POST files/upload`): an intent and no file row. */
  const upload = async (label: string): Promise<string> => {
    const response = await fetch(
      `${base}/api/app/files/upload?orgId=${orgId}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'text/plain',
          cookie: owner.cookie,
          origin: base,
        },
        body: `reject-blob probe: ${label}`,
      },
    );
    const parsed = z
      .object({ storageId: z.string() })
      .safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new Error(`upload ${label}: ${response.status}`);
    refs.push(parsed.data.storageId);
    return parsed.data.storageId;
  };
  /** The UI lane: presign, PUT, then register (which consumes the intent). */
  const uploadAndRegister = async (label: string): Promise<string> => {
    const presigned = z
      .object({ url: z.string().url(), s3Ref: z.string() })
      .safeParse(
        await (
          await post(owner, 'files/blob-upload', { contentType: 'text/plain' })
        )
          .json()
          .catch(() => null),
      );
    if (!presigned.success) throw new Error(`presign ${label} failed`);
    refs.push(presigned.data.s3Ref);
    await fetch(presigned.data.url, {
      method: 'PUT',
      headers: { 'content-type': 'text/plain' },
      body: `reject-blob probe: ${label}`,
    });
    const registered = await post(owner, 'files/register', {
      storageRef: presigned.data.s3Ref,
      fileName: `${label}.txt`,
      contentType: 'text/plain',
    });
    if (!registered.ok) {
      throw new Error(`register ${label}: ${registered.status}`);
    }
    return presigned.data.s3Ref;
  };
  const reject = async (actor: Actor, ref: string): Promise<string> => {
    const response = await post(actor, 'files/reject-blob', {
      storageRef: ref,
    });
    const parsed = rejected.safeParse(await response.json().catch(() => null));
    return parsed.success
      ? String(parsed.data.deleted)
      : `ERR ${response.status}`;
  };
  /** The task door with `ref` as the new task's attachment. */
  const attach = async (ref: string, label: string) => {
    const response = await post(owner, 'tasks', {
      projectId,
      title: `Rejected upload probe: ${label}`,
      attachments: [
        {
          fileId: ref,
          fileName: `${label}.txt`,
          fileType: 'text/plain',
          fileSize: 24,
        },
      ],
    });
    const parsed = z
      .object({ taskId: z.string() })
      .safeParse(await response.json().catch(() => null));
    return {
      status: response.status,
      taskId: parsed.success ? parsed.data.taskId : null,
    };
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
  const intentState = async (ref: string): Promise<string> => {
    const rows = await sql<{ bound: boolean; consumed: boolean }[]>`
      SELECT bound_at_ms IS NOT NULL AS bound,
             consumed_at_ms IS NOT NULL AS consumed
      FROM app.upload_intents WHERE s3_ref = ${ref}
    `;
    const row = rows[0];
    return row === undefined
      ? 'gone'
      : `bound=${row.bound},consumed=${row.consumed}`;
  };
  let rank = 0;
  const insertTask = async (
    db: Sql | TransactionSql,
    column: 'attachments' | 'outputs',
    ref: string,
  ): Promise<void> => {
    rank += 1;
    const list = db.json([
      {
        fileId: ref,
        fileName: 'held.txt',
        fileType: 'text/plain',
        fileSize: 24,
      },
    ]);
    await db`
      INSERT INTO app.tasks (
        org_id, project_id, title, status, rank, created_by, created_by_type,
        ${db(column)}, created_at_ms, updated_at_ms
      ) VALUES (
        ${orgId}, ${projectId}, 'Task holding a probe blob', 'todo',
        ${`r${rank}`}, ${owner.userId}, 'user', ${list}, ${Date.now()},
        ${Date.now()}
      )
    `;
  };

  try {
    // The controls the fix must keep: the caller's own unbound upload goes;
    // another member's and a registered one stay.
    const c1 = await upload('c1-unbound');
    const c1Answer = await reject(owner, c1);
    const c1Gone = !(await present(c1));
    const c2 = await upload('c2-foreign');
    const c2Answer = await reject(member, c2);
    const c2Kept = await present(c2);
    const c3 = await uploadAndRegister('c3-registered');
    const c3Answer = await reject(owner, c3);
    const c3Kept = await present(c3);
    record(
      'reject-blob reclaims the caller’s unbound upload and refuses a foreign or registered one',
      c1Answer === 'true' &&
        c1Gone &&
        c2Answer === 'false' &&
        c2Kept &&
        c3Answer === 'false' &&
        c3Kept,
      `unbound=${c1Answer}/gone=${c1Gone} (want true/true), foreign=${c2Answer}/kept=${c2Kept} (want false/true), registered=${c3Answer}/kept=${c3Kept} (want false/true)`,
    );

    // The finding: the task door binds without consuming, so the reclaim
    // found the intent open and deleted the bytes the card still lists.
    const p1 = await uploadAndRegister('p1-registered-attached');
    const p1Task = await attach(p1, 'p1');
    const p1Answer = await reject(owner, p1);
    const p1Kept = await present(p1);
    const p2 = await upload('p2-attached');
    const p2Task = await attach(p2, 'p2');
    const p2Answer = await reject(owner, p2);
    const p2Kept = await present(p2);
    const p2Listed = await listed(p2Task.taskId, p2);
    const p2Intent = await intentState(p2);
    record(
      'reject-blob keeps the bytes of an upload a task lists (#4104)',
      p1Task.status === 200 &&
        p1Answer === 'false' &&
        p1Kept &&
        p2Task.status === 200 &&
        p2Answer === 'false' &&
        p2Kept &&
        p2Listed,
      `registered+attached: attach=${p1Task.status} reject=${p1Answer} kept=${p1Kept} (want 200/false/true); upload+attached: attach=${p2Task.status} reject=${p2Answer} kept=${p2Kept} listed=${p2Listed} (want 200/false/true/true), intent ${p2Intent}`,
    );

    // The holders count on their own, stamp or not: a document's current
    // file, a document's retained version, a task's deliverable.
    const docCurrent = await upload('held-document-current');
    const docHistory = await upload('held-document-history');
    const taskOutput = await upload('held-task-output');
    await sql`
      INSERT INTO app.documents (id, org_id, file_ref, created_at_ms,
                                 updated_at_ms)
      VALUES (${randomUUID()}, ${orgId}, ${docCurrent}, ${now}, ${now})
    `;
    await sql`
      INSERT INTO app.documents (id, org_id, file_ref, history_files,
                                 created_at_ms, updated_at_ms)
      VALUES (${randomUUID()}, ${orgId}, NULL, ${[docHistory]}, ${now},
              ${now})
    `;
    await insertTask(sql, 'outputs', taskOutput);
    const heldAnswers = [
      await reject(owner, docCurrent),
      await reject(owner, docHistory),
      await reject(owner, taskOutput),
    ];
    const heldKept = [
      await present(docCurrent),
      await present(docHistory),
      await present(taskOutput),
    ];
    record(
      'reject-blob keeps the bytes a document or a task holds, stamped or not',
      heldAnswers.every((answer) => answer === 'false') &&
        heldKept.every(Boolean),
      `document file_ref=${heldAnswers[0]}/kept=${heldKept[0]}, document history_files=${heldAnswers[1]}/kept=${heldKept[1]}, task outputs=${heldAnswers[2]}/kept=${heldKept[2]} (want false/true each)`,
    );

    // A non-consuming proof that leaves no row of its own — the outbound
    // mail door's — vouches for the blob through the stamp alone.
    const vouched = await upload('vouched-mail');
    const foreign = await firstForeignUpload(
      sql,
      { organizationId: orgId, userId: owner.userId },
      [vouched],
    );
    const vouchedAnswer = await reject(owner, vouched);
    const vouchedKept = await present(vouched);
    record(
      'reject-blob keeps the bytes a non-consuming bind vouched for',
      foreign === null && vouchedAnswer === 'false' && vouchedKept,
      `proof=${foreign === null ? 'owned' : 'foreign'} (want owned), reject=${vouchedAnswer}/kept=${vouchedKept} (want false/true), intent ${await intentState(vouched)}`,
    );

    // The reclaim closes the intent: a reclaimed ref is no longer the
    // caller's to bind, so no task can list bytes that are gone. Attached
    // straight after the reclaim — the next mint's sweep drops a consumed
    // row, which would hide a reclaim that only consumed it.
    const reclaimed = await upload('reclaimed-then-attached');
    const reclaimedAnswer = await reject(owner, reclaimed);
    const reclaimedIntent = await intentState(reclaimed);
    const reclaimedAttach = await attach(reclaimed, 'reclaimed');
    record(
      'a reclaimed upload can no longer be attached to a task',
      reclaimedAnswer === 'true' && reclaimedAttach.status === 403,
      `reject=${reclaimedAnswer} (want true), intent ${reclaimedIntent}, attach=${reclaimedAttach.status} (want 403)`,
    );

    // A bind whose transaction stamped the intent and is still open (a
    // create the client timed out on, the task door mid-commit): the reclaim
    // must wait for it and see the stamp, never delete under it.
    const raced = await upload('raced-bind');
    let letGo: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      letGo = resolve;
    });
    let stampedNow: () => void = () => undefined;
    const stamped = new Promise<void>((resolve) => {
      stampedNow = resolve;
    });
    let raceAnswer = 'not run';
    let waited = false;
    let bound = false;
    try {
      const binding = sql.begin(async (tx) => {
        const owned = await ownsUploadedBlob(tx, {
          organizationId: orgId,
          userId: owner.userId,
          storageRef: raced,
        });
        await insertTask(tx, 'attachments', raced);
        stampedNow();
        await held;
        return owned;
      });
      await Promise.race([stamped, binding]);
      const reclaim = reject(owner, raced);
      for (let attempt = 0; attempt < 200 && !waited; attempt += 1) {
        const waiting = await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database()
            AND wait_event_type = 'Lock'
            AND query ILIKE '%app.upload_intents%'
        `;
        waited = (waiting[0]?.n ?? 0) > 0;
        if (!waited) await sleep(50);
      }
      letGo();
      bound = await binding;
      raceAnswer = await reclaim;
    } finally {
      letGo();
    }
    const racedKept = await present(raced);
    record(
      'reject-blob racing a bind that commits keeps the bytes',
      waited && bound && raceAnswer === 'false' && racedKept,
      `reclaim waited on the bind=${waited} (want true), bind=${bound} (want true), reject=${raceAnswer}/kept=${racedKept} (want false/true)`,
    );
  } catch (error) {
    // Recorded, never thrown: a thrown lane truncates every later lane.
    record(
      'rejected-upload reclaim lane runs to completion',
      false,
      `threw ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    // Leave no probe bytes or rows behind; the project cascades its tasks.
    for (const ref of refs) {
      await s3DeleteObject(store, keyOf(ref)).catch((error: unknown) =>
        console.warn('[itest] reject-blob probe cleanup failed:', error),
      );
    }
    await sql`DELETE FROM app.documents WHERE org_id = ${orgId}
      AND (file_ref = ANY(${refs}) OR history_files && ${refs}::text[])`;
    await sql`DELETE FROM app.file_metadata WHERE org_id = ${orgId}
      AND storage_ref = ANY(${refs})`;
    await sql`DELETE FROM app.upload_intents WHERE org_id = ${orgId}
      AND s3_ref = ANY(${refs})`;
    await sql`DELETE FROM app.projects WHERE id = ${projectId}`;
  }
}
