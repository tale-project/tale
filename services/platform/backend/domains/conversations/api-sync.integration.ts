/** Real HTTP + Postgres proof; mounted by backend/integration-check.ts. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';
import { z } from 'zod';

import {
  apiSnapshotSchema,
  apiSnapshotState,
  claimApiDeliveries,
  failApiDelivery,
  queueApiReply,
  synchronizeConversation,
} from './api-sync.ts';
import { recoverStuckConversationSends } from './send.ts';

const snapshotResult = z.object({
  conversationId: z.string(),
  applied: z.boolean(),
});
const claimResult = z.object({
  deliveries: z.array(
    z.object({
      messageId: z.string(),
      claimToken: z.uuid(),
      conversationId: z.string(),
      externalId: z.string(),
      body: z.string(),
      actorEmail: z.string(),
      attempts: z.number().int(),
      leaseExpiresAt: z.number(),
      lastErrorCode: z.string().nullable(),
      firstClaimedAt: z.number(),
      attachments: z.array(
        z.object({ storageId: z.string(), filename: z.string() }),
      ),
    }),
  ),
});
/** The peek listing's rows are STRICT: a claim token or a body riding
 * along would be the leak the listing exists to avoid. */
const listResult = z.object({
  deliveries: z.array(
    z.strictObject({
      messageId: z.string(),
      conversationId: z.string(),
      externalId: z.string(),
      status: z.enum(['queued', 'leased', 'failed', 'delivered']),
      attempts: z.number().int(),
      availableAt: z.number(),
      retryAt: z.number(),
      claimedAt: z.number().nullable(),
      failedAt: z.number().nullable(),
      lastErrorCode: z.string().nullable(),
      acknowledgedAt: z.number().nullable(),
      receiptId: z.string().nullable(),
    }),
  ),
  isDone: z.boolean(),
  continueCursor: z.string(),
});

export async function checkConversationApi(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const org = await sql<
    { slug: string }[]
  >`SELECT slug FROM organization WHERE id = ${ctx.orgId}`;
  const slug = org[0]?.slug;
  assert.ok(slug);
  const mint = async () => {
    const response = await fetch(`${base}/api/auth/api-key/create`, {
      method: 'POST',
      headers: {
        cookie: ctx.cookie,
        origin: base,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'conversation-sync' }),
    });
    assert.equal(response.status, 200);
    return z.object({ key: z.string() }).parse(await response.json()).key;
  };
  let key = await mint();
  const machine = (path: string, body?: unknown, explicit = true) =>
    fetch(`${base}/api/v1${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(explicit ? { 'X-Organization-Slug': slug } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const app = (path: string, body: unknown) =>
    fetch(`${base}/api/app/conversations${path}?orgId=${ctx.orgId}`, {
      method: 'POST',
      headers: {
        cookie: ctx.cookie,
        origin: base,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  const suffix = randomUUID();
  const externalId = `thread-${suffix}`;
  const externalContactId = `vatplus:client:${suffix}`;
  const contact = await machine('/contacts/bulk', {
    contacts: [
      { name: 'API client', email: '', externalId: externalContactId },
    ],
  });
  assert.equal(contact.status, 201);
  const contactResult = z
    .object({ success: z.number(), failed: z.number() })
    .parse(await contact.json());
  assert.equal(contactResult.success, 1);
  const contactRows = await sql<
    { id: string }[]
  >`SELECT id FROM app.contacts WHERE org_id = ${ctx.orgId} AND external_id = ${externalContactId}`;
  const contactId = contactRows[0]?.id;
  assert.ok(contactId);
  const contactView = z.object({
    updatedAt: z.number(),
    notes: z.string().nullable(),
    address: z.record(z.string(), z.unknown()).nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
  });
  const readContact = async () =>
    contactView.parse(await (await machine(`/contacts/${contactId}`)).json());
  const patchContact = (body: unknown) =>
    fetch(`${base}/api/v1/contacts/${contactId}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${key}`,
        'X-Organization-Slug': slug,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  // A future fixture timestamp proves revisions advance even when two
  // writes share a clock tick or the application clock moves backwards.
  await sql`UPDATE app.contacts SET updated_at_ms = ${Date.now() + 60_000} WHERE id = ${contactId}`;
  const beforeOfficeEdit = await readContact();
  assert.equal(
    (
      await patchContact({
        notes: 'Office-owned note',
        metadata: { staff: 'concurrent office edit' },
        address: { label: 'office extra' },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await patchContact({
        expectedUpdatedAt: beforeOfficeEdit.updatedAt,
        name: 'VAT company',
        metadata: { vatplus: { clientId: suffix } },
        address: { country: 'CH' },
      })
    ).status,
    409,
  );
  const afterOfficeEdit = await readContact();
  assert.ok(afterOfficeEdit.updatedAt > beforeOfficeEdit.updatedAt);
  assert.equal(afterOfficeEdit.notes, 'Office-owned note');
  assert.deepEqual(afterOfficeEdit.metadata, {
    staff: 'concurrent office edit',
  });
  assert.deepEqual(afterOfficeEdit.address, { label: 'office extra' });
  const refreshPatch = {
    expectedUpdatedAt: afterOfficeEdit.updatedAt,
    name: 'VAT company',
    metadata: { ...afterOfficeEdit.metadata, vatplus: { clientId: suffix } },
    address: { ...afterOfficeEdit.address, country: 'CH' },
  };
  const concurrentPatches = await Promise.all([
    patchContact(refreshPatch),
    patchContact(refreshPatch),
  ]);
  assert.equal(
    concurrentPatches.filter((response) => response.status === 200).length,
    1,
  );
  assert.equal(
    concurrentPatches.filter((response) => response.status === 409).length,
    1,
  );
  const mergedContact = await readContact();
  assert.ok(mergedContact.updatedAt > afterOfficeEdit.updatedAt);
  assert.equal(mergedContact.notes, 'Office-owned note');
  assert.deepEqual(mergedContact.metadata, refreshPatch.metadata);
  assert.deepEqual(mergedContact.address, refreshPatch.address);
  assert.equal((await patchContact({ expectedUpdatedAt: -1 })).status, 400);
  record(
    'contact conditional update preserves concurrent office edits',
    true,
    'Stale PATCH leaves notes/metadata/address intact; one concurrent revision wins, refresh merges extras, and revisions advance despite clock rollback',
  );
  const uploaded = await fetch(`${base}/api/v1/conversations/uploads`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'X-Organization-Slug': slug,
      'Content-Type': 'application/pdf',
    },
    body: 'safe attachment bytes',
  });
  assert.equal(uploaded.status, 200);
  const storageId = z
    .object({ storageId: z.string() })
    .parse(await uploaded.json()).storageId;
  const payload = apiSnapshotSchema.parse({
    source: 'vatplus',
    externalId,
    externalContactId,
    version: 0,
    subject: 'API invoice question',
    status: 'open',
    replyConstraints: {
      minBodyChars: 3,
      maxBodyChars: 2000,
      maxAttachments: 5,
      maxAttachmentBytes: 20 * 1024 * 1024,
      attachmentExtensions: ['pdf'],
    },
    messages: [
      {
        externalId: 'source-message',
        content: '<script>alert("unsafe")</script>\n\n**Question**',
        format: 'markdown',
        isCustomer: true,
        authorName: 'Client',
        createdAt: 1000,
        attachments: [
          {
            externalId: 'source-file',
            storageId,
            fileName: 'invoice.pdf',
            contentType: 'application/pdf',
            size: 21,
          },
        ],
      },
    ],
  });
  const created = await Promise.all([
    machine('/conversations/sync', payload),
    machine('/conversations/sync', payload),
  ]);
  assert.ok(created.every((response) => response.status === 200));
  const results = await Promise.all(
    created.map(async (response) =>
      snapshotResult.parse(await response.json()),
    ),
  );
  assert.equal(new Set(results.map((value) => value.conversationId)).size, 1);
  assert.equal(results.filter((value) => value.applied).length, 1);
  // The tenant rule the projects and tasks families share: a key whose
  // holder belongs to ONE organization may omit `X-Organization-Slug`; a
  // multi-organization key must name it (400 ORG_SLUG_REQUIRED). This
  // user has one membership, so the bare replay is accepted.
  assert.equal(
    (await machine('/conversations/sync', payload, false)).status,
    200,
  );
  const firstResult = results[0];
  assert.ok(firstResult);
  const conversationId = firstResult.conversationId;
  let rows = await sql<
    { id: string; content: string; channel: string }[]
  >`SELECT id, content, channel FROM app.conversation_messages WHERE conversation_id = ${conversationId}`;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.channel, 'api');
  const firstMessage = rows[0];
  assert.ok(firstMessage);
  assert.ok(!firstMessage.content.includes('<script>'));
  assert.ok(firstMessage.content.includes('<strong>Question</strong>'));
  assert.equal(
    (
      await machine('/conversations/sync', {
        ...payload,
        subject: 'Different same revision',
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await machine('/conversations/sync', {
        ...payload,
        version: 1,
        externalContactId: 'another-client',
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await machine('/conversations/sync', {
        ...payload,
        version: 1,
        messages: [...payload.messages, payload.messages[0]],
      })
    ).status,
    400,
  );
  const viewer = {
    organizationId: ctx.orgId,
    userId: ctx.userId,
    role: 'owner',
  };
  await assert.rejects(
    synchronizeConversation(
      sql,
      { ...viewer, userId: 'different-service' },
      { ...payload, version: 1 },
    ),
    /another service user/,
  );
  assert.equal(
    await apiSnapshotState(
      sql,
      { ...viewer, organizationId: 'foreign-org' },
      'vatplus',
      externalId,
    ),
    null,
  );
  // A claim names a source this user mirrored: another service user's
  // source is theirs (403), a source no snapshot ever named is absent
  // (404) — never a healthy-looking empty queue.
  await assert.rejects(
    claimApiDeliveries(
      sql,
      { ...viewer, userId: 'different-service' },
      'vatplus',
      100,
    ),
    /another service user/,
  );
  const unknownSource = await machine('/conversations/deliveries/claim', {
    source: `never-${suffix.slice(0, 8)}`,
  });
  assert.equal(unknownSource.status, 404);
  assert.equal(
    z
      .object({ code: z.string() })
      .loose()
      .parse(await unknownSource.json()).code,
    'CONVERSATION_SOURCE_NOT_FOUND',
  );
  await assert.rejects(
    synchronizeConversation(sql, { ...viewer, role: 'viewer' }, payload),
    /editors/,
  );
  const state = await machine(
    `/conversations/sync?${new URLSearchParams({ source: 'vatplus', externalId })}`,
  );
  assert.equal(state.status, 200);
  key = await mint();
  assert.equal((await machine('/conversations/sync', payload)).status, 200);
  record(
    'conversation API source isolation and replay',
    true,
    'Concurrent imports converge, versions conflict, HTML is escaped, org/user ownership and key rotation hold',
  );

  // Office replies use the real Inbox route. A queued reply remains undoable
  // until claim; advancing only this fixture timestamp avoids a wall wait.
  assert.equal(
    (
      await app(`/${conversationId}/reply`, {
        content: '<p>Unverified identity</p>',
        sourceMarkdown: 'Unverified identity',
      })
    ).status,
    403,
  );
  await sql`UPDATE "user" SET "emailVerified" = true WHERE id = ${ctx.userId}`;
  const undoReply = await app(`/${conversationId}/reply`, {
    content: '<p>Undo this reply</p>',
    sourceMarkdown: 'Undo this reply',
  });
  assert.equal(undoReply.status, 201);
  const undoId = z
    .object({ messageId: z.string() })
    .parse(await undoReply.json()).messageId;
  assert.equal((await app(`/messages/${undoId}/undo`, {})).status, 200);
  const undone =
    await sql`SELECT message_id FROM app.conversation_api_deliveries WHERE message_id = ${undoId}`;
  assert.equal(undone.length, 0);
  assert.equal(
    (
      await app(`/${conversationId}/reply`, {
        content: '<p>too long</p>',
        sourceMarkdown: 'x'.repeat(2001),
      })
    ).status,
    400,
  );
  const reply = await app(`/${conversationId}/reply`, {
    content: '<p>Office reply</p>',
    sourceMarkdown: 'Office reply',
    attachments: [
      {
        storageId,
        fileName: 'office.pdf',
        contentType: 'application/pdf',
        size: 21,
      },
    ],
  });
  assert.equal(reply.status, 201);
  const messageId = z
    .object({ messageId: z.string() })
    .parse(await reply.json()).messageId;
  const beforeClaim = claimResult.parse(
    await (
      await machine('/conversations/deliveries/claim', { source: 'vatplus' })
    ).json(),
  );
  assert.ok(!beforeClaim.deliveries.some((row) => row.messageId === messageId));
  await sql`UPDATE app.conversation_api_deliveries SET available_at_ms = ${Date.now() - 1}, retry_at_ms = 0 WHERE message_id = ${messageId}`;
  const claim = async () =>
    claimResult
      .parse(
        await (
          await machine('/conversations/deliveries/claim', {
            source: 'vatplus',
          })
        ).json(),
      )
      .deliveries.find((row) => row.messageId === messageId);
  const delivery = await claim();
  assert.ok(delivery);
  assert.equal(delivery.body, 'Office reply');
  assert.equal(delivery.externalId, externalId);
  // A claim says where the delivery stands (G-03b).
  assert.equal(delivery.attempts, 0);
  assert.equal(delivery.lastErrorCode, null);
  assert.ok(delivery.leaseExpiresAt > Date.now());
  assert.ok(delivery.firstClaimedAt <= Date.now());
  assert.equal(await claim(), undefined);
  // The queue is readable without claiming (G-03a): the leased row shows
  // `leased` with its stamps, and neither the claim token nor the body
  // rides along (the row schema is strict).
  const peek = async (query: Record<string, string>) =>
    listResult.parse(
      await (
        await machine(
          `/conversations/deliveries?${new URLSearchParams({ source: 'vatplus', ...query })}`,
        )
      ).json(),
    );
  const leased = (await peek({})).deliveries.find(
    (row) => row.messageId === messageId,
  );
  assert.equal(leased?.status, 'leased');
  assert.equal(leased?.attempts, 0);
  assert.equal(leased?.claimedAt, delivery.firstClaimedAt);
  assert.equal(leased?.retryAt, delivery.leaseExpiresAt);
  assert.equal(
    (await peek({ status: 'failed' })).deliveries.some(
      (row) => row.messageId === messageId,
    ),
    false,
  );
  assert.equal(
    (await peek({ status: 'leased' })).deliveries.some(
      (row) => row.messageId === messageId,
    ),
    true,
  );
  // A dead worker becomes replayable only after its visibility lease.
  await sql`UPDATE app.conversation_api_deliveries SET retry_at_ms = 0 WHERE message_id = ${messageId}`;
  const queuedAgain = (await peek({ status: 'queued' })).deliveries.find(
    (row) => row.messageId === messageId,
  );
  assert.equal(queuedAgain?.status, 'queued');
  const replay = await claim();
  assert.equal(replay?.messageId, delivery.messageId);
  assert.notEqual(replay?.claimToken, delivery.claimToken);
  // A redelivery keeps the first claim's stamp.
  assert.equal(replay?.firstClaimedAt, delivery.firstClaimedAt);
  assert.equal((await app(`/messages/${messageId}/undo`, {})).status, 409);
  const file = await machine(
    `/conversations/deliveries/${messageId}/attachments/0`,
  );
  assert.equal(file.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(await file.text(), 'safe attachment bytes');
  const receiptId = `vat-message-${suffix}`;
  const deliveredSnapshot = {
    ...payload,
    version: 2,
    messages: [
      ...payload.messages,
      {
        externalId: receiptId,
        taleMessageId: messageId,
        content: 'Office reply',
        format: 'markdown',
        isCustomer: false,
        authorName: 'Office',
        createdAt: 1000,
        attachments: [],
      },
    ],
  };
  assert.equal(
    (await machine('/conversations/sync', deliveredSnapshot)).status,
    409,
  );
  for (let attempt = 0; attempt < 2; attempt++)
    assert.equal(
      (
        await machine(`/conversations/deliveries/${messageId}/ack`, {
          receiptId,
          sourceVersion: 2,
        })
      ).status,
      200,
    );
  assert.equal(
    (
      await machine(`/conversations/deliveries/${messageId}/ack`, {
        receiptId: 'different',
        sourceVersion: 2,
      })
    ).status,
    409,
  );
  assert.equal(await claim(), undefined);
  const acknowledged = (await peek({ status: 'delivered' })).deliveries.find(
    (row) => row.messageId === messageId,
  );
  assert.equal(acknowledged?.status, 'delivered');
  assert.equal(acknowledged?.receiptId, receiptId);
  // An old source snapshot may arrive after a newer native delivery is
  // acknowledged. Its missing receipt must not erase that newer reply.
  assert.equal(
    (await machine('/conversations/sync', { ...payload, version: 1 })).status,
    200,
  );
  const pendingRevision =
    await sql`SELECT id FROM app.conversation_messages WHERE id = ${messageId}`;
  assert.equal(pendingRevision.length, 1);
  assert.equal(
    (await machine('/conversations/sync', deliveredSnapshot)).status,
    200,
  );
  rows =
    await sql`SELECT id, content, channel FROM app.conversation_messages WHERE conversation_id = ${conversationId}`;
  assert.equal(rows.length, 2);
  assert.ok(rows.some((row) => row.id === messageId));
  const nativeRows = await sql<
    { deliveryState: string }[]
  >`SELECT delivery_state AS "deliveryState" FROM app.conversation_messages WHERE id = ${messageId}`;
  assert.equal(nativeRows[0]?.deliveryState, 'delivered');
  record(
    'conversation API delivery and attachment receipts',
    true,
    'Verified native reply/undo/claim/bytes/ack replay succeed; source acknowledgement reuses the same message, including equal timestamps and out-of-order snapshots',
  );

  // A full page of refused authors must never starve reply 101. Use the
  // native queue service for volume; UI reply/undo is exercised above.
  const queued: string[] = [];
  for (let index = 0; index < 101; index++)
    queued.push(
      await queueApiReply(sql, {
        organizationId: ctx.orgId,
        conversationId,
        content: '<p>Delivery isolation check</p>',
        body: 'Delivery isolation check',
        attachments: [],
        actor: { userId: ctx.userId, email: delivery.actorEmail },
        availableAt: index,
      }),
    );
  // The listing pages the queue in claim order with a signed cursor; one
  // source's cursor never redeems on another's.
  const pageOne = await peek({ limit: '100' });
  assert.equal(pageOne.deliveries.length, 100);
  assert.equal(pageOne.isDone, false);
  const pageTwo = await peek({ limit: '100', cursor: pageOne.continueCursor });
  assert.ok(pageTwo.deliveries.length >= 1);
  assert.ok(
    !pageTwo.deliveries.some((row) =>
      pageOne.deliveries.some((one) => one.messageId === row.messageId),
    ),
  );
  // A cursor is signed for the list it pages — one source's cursor is not
  // a position on another's, and the door refuses it as it refuses every
  // cursor it did not mint (400 INVALID_CURSOR), never as a missing row.
  const foreignCursor = await machine(
    `/conversations/deliveries?${new URLSearchParams({ source: 'other-source', cursor: pageOne.continueCursor })}`,
  );
  assert.equal(foreignCursor.status, 400);
  assert.equal(
    z
      .object({ code: z.string() })
      .loose()
      .parse(await foreignCursor.json()).code,
    'INVALID_CURSOR',
  );
  const refused = await claimApiDeliveries(sql, viewer, 'vatplus', 100);
  assert.equal(refused.length, 100);
  for (const row of refused) {
    assert.ok(row.claimToken);
    await failApiDelivery(sql, viewer, row.messageId, {
      claimToken: row.claimToken,
      code: 'platform_forbidden',
      permanent: true,
    });
  }
  const goodId = queued.at(-1);
  assert.ok(goodId);
  const later = await claimApiDeliveries(sql, viewer, 'vatplus', 100);
  assert.deepEqual(
    later.map((row) => row.messageId),
    [goodId],
  );
  const firstRefusal = refused[0];
  assert.ok(firstRefusal?.claimToken);
  const repeatedFailure = {
    claimToken: firstRefusal.claimToken,
    code: 'platform_forbidden',
    permanent: true,
  };
  assert.equal(
    (
      await machine(
        `/conversations/deliveries/${firstRefusal.messageId}/fail`,
        repeatedFailure,
      )
    ).status,
    200,
  );
  const attempts = await sql<
    { attempts: number }[]
  >`SELECT attempt_count AS attempts FROM app.conversation_api_deliveries WHERE message_id = ${firstRefusal.messageId}`;
  assert.equal(attempts[0]?.attempts, 1);
  assert.equal(
    (await app(`/messages/${firstRefusal.messageId}/discard`, {})).status,
    200,
  );
  assert.equal(
    (
      await sql`SELECT message_id FROM app.conversation_api_deliveries WHERE message_id = ${firstRefusal.messageId}`
    ).length,
    0,
  );
  const concurrentId = refused[1]?.messageId;
  assert.ok(concurrentId);
  const contested = await Promise.all([
    app(`/messages/${concurrentId}/retry`, {}),
    app(`/messages/${concurrentId}/discard`, {}),
  ]);
  assert.equal(
    contested.filter((response) => response.status === 200).length,
    1,
  );
  assert.ok(
    contested.every((response) => [200, 404, 409].includes(response.status)),
  );
  // Either the operator discarded it or retry won; exclude this separate
  // race fixture from the next claim batch under test.
  await sql`DELETE FROM app.conversation_messages WHERE id = ${concurrentId}`;
  await sql`UPDATE app.conversation_messages SET status_changed_at_ms = 1 WHERE id = ${goodId}`;
  await recoverStuckConversationSends(sql);
  assert.equal(
    (
      await sql<
        { state: string }[]
      >`SELECT delivery_state AS state FROM app.conversation_messages WHERE id = ${goodId}`
    )[0]?.state,
    'queued',
  );
  let active = later[0];
  assert.ok(active?.claimToken);
  const oldToken = active.claimToken;
  for (let index = 0; index < 10; index++) {
    assert.ok(active?.claimToken);
    await failApiDelivery(sql, viewer, goodId, {
      claimToken: active.claimToken,
      code: 'network_error',
      permanent: false,
    });
    assert.deepEqual(await claimApiDeliveries(sql, viewer, 'vatplus', 100), []);
    await sql`UPDATE app.conversation_api_deliveries SET retry_at_ms = 0 WHERE message_id = ${goodId}`;
    active = (await claimApiDeliveries(sql, viewer, 'vatplus', 100))[0];
  }
  assert.equal(active, undefined);
  assert.equal(
    (
      await sql<
        { state: string }[]
      >`SELECT delivery_state AS state FROM app.conversation_messages WHERE id = ${goodId}`
    )[0]?.state,
    'failed',
  );
  // Dead-lettered: the listing shows it with its ten attempts and the last
  // code (G-03a), and the REST retry re-drives it — the same audited
  // action as the Inbox's Retry (G-03c); a second retry is 409, a foreign
  // id 404.
  const dead = (await peek({ status: 'failed' })).deliveries.find(
    (row) => row.messageId === goodId,
  );
  assert.equal(dead?.status, 'failed');
  assert.equal(dead?.attempts, 10);
  assert.equal(dead?.lastErrorCode, 'network_error');
  assert.ok(dead?.failedAt);
  const restRetry = await machine(
    `/conversations/deliveries/${goodId}/retry`,
    {},
  );
  assert.equal(restRetry.status, 200);
  assert.deepEqual(await restRetry.json(), { ok: true });
  const retryAgain = await machine(
    `/conversations/deliveries/${goodId}/retry`,
    {},
  );
  assert.equal(retryAgain.status, 409);
  assert.equal(
    z
      .object({ code: z.string() })
      .loose()
      .parse(await retryAgain.json()).code,
    'DELIVERY_RETRY_UNAVAILABLE',
  );
  const retryForeign = await machine(
    `/conversations/deliveries/no-such-${suffix}/retry`,
    {},
  );
  assert.equal(retryForeign.status, 404);
  assert.equal(
    z
      .object({ code: z.string() })
      .loose()
      .parse(await retryForeign.json()).code,
    'DELIVERY_NOT_FOUND',
  );
  const requeued = (await peek({ status: 'queued' })).deliveries.find(
    (row) => row.messageId === goodId,
  );
  assert.equal(requeued?.status, 'queued');
  assert.equal(requeued?.attempts, 0);
  assert.equal(requeued?.lastErrorCode, null);
  const retried = (await claimApiDeliveries(sql, viewer, 'vatplus', 100))[0];
  assert.equal(retried?.messageId, goodId);
  await failApiDelivery(sql, viewer, goodId, {
    claimToken: oldToken,
    code: 'platform_forbidden',
    permanent: true,
  });
  assert.equal(
    (
      await sql<
        { state: string }[]
      >`SELECT delivery_state AS state FROM app.conversation_messages WHERE id = ${goodId}`
    )[0]?.state,
    'queued',
  );
  assert.equal((await app(`/messages/${goodId}/discard`, {})).status, 409);
  const jobs =
    await sql`SELECT id FROM pgboss.job WHERE name = 'conversation.send_message' AND data->>'messageId' = ${goodId}`;
  assert.equal(jobs.length, 0);
  // Isolated fixture cleanup prevents these intentionally failed rows from
  // changing the source-deletion assertions below.
  await sql`DELETE FROM app.conversation_messages WHERE id IN ${sql(queued)}`;
  record(
    'conversation API failure isolation and bounded retries',
    true,
    '100 refused replies cannot starve reply 101; leases, failure replay, backoff, ten-attempt stop, the peek listing (statuses, pages, no token), REST retry (200/409/404), native retry/discard and email-watchdog separation hold',
  );

  assert.equal(
    (
      await machine('/conversations/sync', {
        ...deliveredSnapshot,
        version: 3,
        messages: [deliveredSnapshot.messages[1]],
      })
    ).status,
    200,
  );
  rows =
    await sql`SELECT id, content, channel FROM app.conversation_messages WHERE conversation_id = ${conversationId}`;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.id, messageId);
  const stale = snapshotResult.parse(
    await (await machine('/conversations/sync', payload)).json(),
  );
  assert.equal(stale.applied, false);
  const deletion = {
    ...payload,
    version: 4,
    status: 'closed',
    deleted: true,
    messages: [],
  };
  for (let attempt = 0; attempt < 2; attempt++)
    assert.equal((await machine('/conversations/sync', deletion)).status, 200);
  rows =
    await sql`SELECT id, content, channel FROM app.conversation_messages WHERE conversation_id = ${conversationId}`;
  assert.equal(rows.length, 0);
  // A teardown is not content: at the stored version with a different
  // subject it is still a replay of the deletion (200, nothing applied),
  // not the 409 a content snapshot at that version would get.
  const deletionAgain = snapshotResult.parse(
    await (
      await machine('/conversations/sync', {
        ...deletion,
        subject: 'Different words, same teardown',
      })
    ).json(),
  );
  assert.equal(deletionAgain.applied, false);
  // A source whose versions ran out can still close its mirror: a
  // deleted snapshot applies at the stored version itself, so the
  // documented maximum version is not a trap (G-04).
  const maxedId = `thread-max-${suffix}`;
  const maxed = {
    ...payload,
    externalId: maxedId,
    version: Number.MAX_SAFE_INTEGER,
    messages: [],
  };
  assert.equal((await machine('/conversations/sync', maxed)).status, 200);
  const maxedDeletion = snapshotResult.parse(
    await (
      await machine('/conversations/sync', {
        ...maxed,
        status: 'closed',
        deleted: true,
      })
    ).json(),
  );
  assert.equal(maxedDeletion.applied, true);
  const maxedBinding = await sql<
    { sourceDeleted: boolean }[]
  >`SELECT source_deleted AS "sourceDeleted" FROM app.conversation_api_bindings WHERE conversation_id = ${maxedDeletion.conversationId}`;
  assert.equal(maxedBinding[0]?.sourceDeleted, true);
  assert.equal(
    (
      await app(`/${conversationId}/reply`, {
        content: 'Cannot reply',
        sourceMarkdown: 'Cannot reply',
      })
    ).status,
    409,
  );
  record(
    'conversation API source edits and tombstones',
    true,
    'Source deletion reconciles acknowledged messages, stale snapshots cannot restore them, a teardown replays at its version and applies at the maximum version, deleted source threads refuse replies',
  );
}
