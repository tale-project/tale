/**
 * Real Postgres and the object-store pin: a pending outbound mail and a chat
 * message hold the bytes they list (#4111). Both name an attachment by blob
 * ref with no file row of their own — the mail in `metadata.attachments`
 * until its send goes out, the chat message in its parts, which every later
 * turn of the thread replays from the ref. `blobRefHeld` and the release
 * seam (`knowledge/liveness.ts`) knew neither, so deleting or purging the
 * file row a reply attached took the bytes inside the undo window, and the
 * send then could not find them. Every user write goes through the session
 * doors (the chat row stands in for the turn, which needs a model); every
 * verdict on the bytes is a HEAD against the store.
 */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';
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
import { createConversation } from '../conversations/service.ts';
import { runReleaseRefsJob } from '../knowledge/release.ts';
import { ensureDefaultObjectStore } from '../object_storage/bootstrap.ts';

interface Actor {
  cookie: string;
  userId: string;
}

const keyOf = (ref: string) => (ref.startsWith('s3:') ? ref.slice(3) : ref);

export async function checkMessageHeldBlobs(
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
      'message-held blobs',
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
      OBJECT_STORE_BUCKET: `itest-message-held-${suffix}`,
      OBJECT_STORE_ACCESS_KEY: objectStore.accessKeyId,
      OBJECT_STORE_SECRET_KEY: objectStore.secretAccessKey,
    });
  }
  const store = await resolveObjectStore(orgSlug);
  // Its own admin, so the lane spends no shared upload budget; verified,
  // because the API channel sends under the author's verified address.
  const owner = await signUpMember(`message-held-${suffix}`, 'admin');
  await sql`UPDATE "user" SET "emailVerified" = true WHERE id = ${owner.userId}`;

  const call = (method: string, route: string, body?: unknown) =>
    fetch(`${base}/api/app/${route}?orgId=${orgId}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        cookie: owner.cookie,
        origin: base,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const present = async (ref: string): Promise<boolean> =>
    (await s3HeadObject(store, keyOf(ref))) !== null;
  const refs: string[] = [];
  const conversationIds: string[] = [];
  const threadId = randomUUID();
  /** The UI lane: presign, PUT, register — a file row the owner uploaded. */
  const uploadAndRegister = async (label: string) => {
    const text = `message-held probe: ${label}`;
    const presigned = z
      .object({ url: z.string().url(), s3Ref: z.string() })
      .safeParse(
        await (
          await call('POST', 'files/blob-upload', { contentType: 'text/plain' })
        )
          .json()
          .catch(() => null),
      );
    if (!presigned.success) throw new Error(`presign ${label} failed`);
    const ref = presigned.data.s3Ref;
    refs.push(ref);
    await fetch(presigned.data.url, {
      method: 'PUT',
      headers: { 'content-type': 'text/plain' },
      body: text,
    });
    const registered = await call('POST', 'files/register', {
      storageRef: ref,
      fileName: `${label}.txt`,
      contentType: 'text/plain',
    });
    if (!registered.ok) {
      throw new Error(`register ${label}: ${registered.status}`);
    }
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM app.file_metadata
      WHERE org_id = ${orgId} AND storage_ref = ${ref}
    `;
    return { ref, fileId: rows[0]?.id ?? '', size: Buffer.byteLength(text) };
  };
  /** The byte lane (`POST files/upload`): an intent of the owner's, no row. */
  const uploadBytes = async (label: string) => {
    const text = `message-held probe: ${label}`;
    const response = await fetch(
      `${base}/api/app/files/upload?orgId=${orgId}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'text/plain',
          cookie: owner.cookie,
          origin: base,
        },
        body: text,
      },
    );
    const parsed = z
      .object({ storageId: z.string() })
      .safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new Error(`upload ${label}: ${response.status}`);
    refs.push(parsed.data.storageId);
    return { ref: parsed.data.storageId, size: Buffer.byteLength(text) };
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
  /** The reply door with the file as the reply's only attachment. */
  const reply = async (
    conversationId: string,
    file: { ref: string; size: number },
  ) => {
    const response = await call(
      'POST',
      `conversations/${conversationId}/reply`,
      {
        content: '<p>The file you asked for.</p>',
        attachments: [
          {
            storageId: file.ref,
            fileName: 'held.txt',
            contentType: 'text/plain',
            size: file.size,
          },
        ],
      },
    );
    const parsed = z
      .object({ messageId: z.string() })
      .safeParse(await response.json().catch(() => null));
    return {
      status: response.status,
      messageId: parsed.success ? parsed.data.messageId : null,
    };
  };
  let order = 0;
  /** The user row a chat turn writes for a message with one attachment. */
  const chatMessage = async (file: { ref: string; size: number }) => {
    order += 1;
    await sql`
      INSERT INTO app.messages (thread_id, org_id, "order", step_order, role,
                                parts, text, author_id, created_at_ms)
      VALUES (${threadId}, ${orgId}, ${order}, 0, 'user',
              ${sql.json([
                { type: 'text', text: 'What does this file say?' },
                {
                  type: 'attachment',
                  name: 'held.txt',
                  mediaType: 'text/plain',
                  fileId: file.ref,
                  sizeBytes: file.size,
                },
              ])},
              'What does this file say?', ${owner.userId}, ${Date.now()})
    `;
    return { status: 201, messageId: null };
  };
  const deliveryState = async (messageId: string | null) => {
    if (messageId === null) return 'none';
    const rows = await sql<{ state: string }[]>`
      SELECT delivery_state AS state FROM app.conversation_messages
      WHERE id = ${messageId}
    `;
    return rows[0]?.state ?? 'gone';
  };
  const rowGone = async (fileId: string) =>
    (
      await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM app.file_metadata WHERE id = ${fileId}
      `
    )[0]?.n === 0;

  // The undo window of every reply below outlasts the lane, so no send
  // fires while it looks: the bytes must survive on the queued row alone.
  const previousDelay = process.env.CONVERSATION_UNDO_SEND_DELAY_MS;
  process.env.CONVERSATION_UNDO_SEND_DELAY_MS = '600000';
  try {
    const now = Date.now();
    const contacts = await sql<{ id: string }[]>`
      INSERT INTO app.contacts (org_id, name, email, source, created_at_ms,
                                updated_at_ms)
      VALUES (${orgId}, 'Held Blob Customer', ${`held-${suffix}@ext.test`},
              'api_import', ${now}, ${now})
      RETURNING id
    `;
    const emailConversation = await sql.begin((tx) =>
      createConversation(tx, {
        organizationId: orgId,
        contactId: contacts[0]?.id ?? '',
        subject: 'Held blob probe',
        channel: 'email',
        direction: 'inbound',
        connectorName: 'imap-smtp',
        externalMessageId: `held-root-${suffix}@ext.test`,
      }),
    );
    conversationIds.push(emailConversation);
    const apiConversation = randomUUID();
    const source = `itest-held-${suffix}`;
    await sql`
      INSERT INTO app.conversations (id, org_id, subject, status, channel,
                                     direction, connector_name, created_at_ms)
      VALUES (${apiConversation}, ${orgId}, 'Held blob API probe', 'open',
              'api', 'inbound', ${source}, ${now})
    `;
    conversationIds.push(apiConversation);
    await sql`
      INSERT INTO app.conversation_api_bindings (
        conversation_id, org_id, source, external_id, external_contact_id,
        owner_user_id
      ) VALUES (${apiConversation}, ${orgId}, ${source}, ${`ext-${suffix}`},
                ${`contact-${suffix}`}, ${owner.userId})
    `;
    await sql`
      INSERT INTO app.threads (id, org_id, user_id, title, kind,
                               created_at_ms, updated_at_ms)
      VALUES (${threadId}, ${orgId}, ${owner.userId}, 'Held blob chat',
              'chat', ${now}, ${now})
    `;
    const holders = [
      {
        name: 'email reply',
        bind: (file: { ref: string; size: number }) =>
          reply(emailConversation, file),
      },
      {
        name: 'API reply',
        bind: (file: { ref: string; size: number }) =>
          reply(apiConversation, file),
      },
      { name: 'chat message', bind: chatMessage },
    ];

    // `deleteFile` inside the undo window: the row goes, the bytes stay.
    const deleted: string[] = [];
    let deletedOk = true;
    for (const holder of holders) {
      const file = await uploadAndRegister(`delete-${holder.name}`);
      const bound = await holder.bind(file);
      const removed = await call('DELETE', `files/${file.fileId}`);
      const gone = await rowGone(file.fileId);
      const kept = await present(file.ref);
      const state = await deliveryState(bound.messageId);
      deletedOk &&=
        bound.status === 201 && removed.status === 200 && gone && kept;
      deleted.push(
        `${holder.name}: bind=${bound.status} delete=${removed.status} rowGone=${gone} kept=${kept} state=${state}`,
      );
    }
    record(
      'deleting a file keeps the bytes a pending reply (email, API) or a chat message lists (#4111)',
      deletedOk,
      `${deleted.join('; ')} (want 201/200/true/true each, a reply still queued)`,
    );

    // A purge through the release seam: the row is trashed, nothing but the
    // message lists the ref, and the release must keep the bytes.
    const purged: string[] = [];
    let purgedOk = true;
    for (const holder of holders) {
      const file = await uploadAndRegister(`purge-${holder.name}`);
      const bound = await holder.bind(file);
      await sql`
        UPDATE app.file_metadata SET lifecycle_status = 'trashed'
        WHERE id = ${file.fileId}
      `;
      let release = 'ok';
      try {
        await runReleaseRefsJob(sql, {
          organizationId: orgId,
          refs: [file.ref],
        });
      } catch (error) {
        release = error instanceof Error ? error.message : String(error);
      }
      const kept = await present(file.ref);
      purgedOk &&= bound.status === 201 && release === 'ok' && kept;
      purged.push(
        `${holder.name}: bind=${bound.status} release=${release} kept=${kept}`,
      );
    }
    record(
      'a purge keeps the bytes a pending reply (email, API) or a chat message lists (#4111)',
      purgedOk,
      `${purged.join('; ')} (want 201/ok/true each)`,
    );

    // The control: a reply that went out holds nothing — the copy the
    // recipient got is theirs — so deleting its file releases the bytes.
    const sent = await uploadAndRegister('sent-reply');
    const sentReply = await reply(emailConversation, sent);
    await sql`
      UPDATE app.conversation_messages SET delivery_state = 'sent'
      WHERE id = ${sentReply.messageId ?? ''}
    `;
    const sentDelete = await call('DELETE', `files/${sent.fileId}`);
    const sentGone = !(await present(sent.ref));
    record(
      'a sent reply holds nothing: deleting its file releases the bytes',
      sentReply.status === 201 && sentDelete.status === 200 && sentGone,
      `reply=${sentReply.status} delete=${sentDelete.status} gone=${sentGone} (want 201/200/true)`,
    );

    // A send the door refuses leaves no stamp (#4111): the proof that
    // stamps runs in the send's transaction, so the refusal rolls it back,
    // and the upload stays the caller's to reclaim. The API app here takes
    // no attachments, which the reply's own transaction refuses.
    const refusingConversation = randomUUID();
    await sql`
      INSERT INTO app.conversations (id, org_id, subject, status, channel,
                                     direction, connector_name, created_at_ms)
      VALUES (${refusingConversation}, ${orgId}, 'Held blob refusing probe',
              'open', 'api', 'inbound', ${source}, ${Date.now()})
    `;
    conversationIds.push(refusingConversation);
    await sql`
      INSERT INTO app.conversation_api_bindings (
        conversation_id, org_id, source, external_id, external_contact_id,
        owner_user_id, reply_constraints
      ) VALUES (${refusingConversation}, ${orgId}, ${source},
                ${`ext-refusing-${suffix}`}, ${`contact-${suffix}`},
                ${owner.userId}, ${sql.json({ maxAttachments: 0 })})
    `;
    const staged = await uploadBytes('refused-send');
    const refused = await reply(refusingConversation, staged);
    const stamp = await intentState(staged.ref);
    const reclaim = await call('POST', 'files/reject-blob', {
      storageRef: staged.ref,
    });
    const reclaimed = z
      .object({ deleted: z.boolean() })
      .safeParse(await reclaim.json().catch(() => null));
    const stagedGone = !(await present(staged.ref));
    record(
      'a refused send leaves no stamp, so its upload stays reclaimable (#4111)',
      refused.status === 400 &&
        stamp === 'bound=false,consumed=false' &&
        reclaimed.success &&
        reclaimed.data.deleted &&
        stagedGone,
      `reply=${refused.status} (want 400), intent ${stamp} (want bound=false,consumed=false), reject=${reclaimed.success ? String(reclaimed.data.deleted) : `ERR ${reclaim.status}`}/gone=${stagedGone} (want true/true)`,
    );
  } catch (error) {
    // Recorded, never thrown: a thrown lane truncates every later lane.
    record(
      'message-held blobs lane runs to completion',
      false,
      `threw ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    if (previousDelay === undefined) {
      delete process.env.CONVERSATION_UNDO_SEND_DELAY_MS;
    } else {
      process.env.CONVERSATION_UNDO_SEND_DELAY_MS = previousDelay;
    }
    // Leave no probe bytes or rows behind. The conversations cascade their
    // messages (a queued send's job then finds nothing to claim), the thread
    // its messages.
    for (const ref of refs) {
      await s3DeleteObject(store, keyOf(ref)).catch((error: unknown) =>
        console.warn('[itest] message-held probe cleanup failed:', error),
      );
    }
    await sql`DELETE FROM app.conversations WHERE id = ANY(${conversationIds})`;
    await sql`DELETE FROM app.threads WHERE id = ${threadId}`;
    await sql`DELETE FROM app.contacts WHERE org_id = ${orgId}
      AND email = ${`held-${suffix}@ext.test`}`;
    await sql`DELETE FROM app.file_metadata WHERE org_id = ${orgId}
      AND storage_ref = ANY(${refs})`;
    await sql`DELETE FROM app.upload_intents WHERE org_id = ${orgId}
      AND s3_ref = ANY(${refs})`;
  }
}
