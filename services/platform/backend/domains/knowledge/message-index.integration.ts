/** Real-Postgres, real-worker proof of indexed inbound email bodies (#3015):
 * the mailbox ingest queues `rag.index_message` in the insert's own
 * transaction, the live worker indexes the body under its message ref with
 * its conversation stamped, retrieval serves it to whoever may read that
 * conversation — through the door that asks for bodies, and no other — and
 * deleting the conversation releases its corpus rows. Needs no object store:
 * a message has no bytes. */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { messageRef } from '../../../lib/knowledge/message-ref.ts';
import { PRIVATE_KNOWLEDGE_SCHEMA } from '../../../lib/knowledge/types.ts';
import { getKnowledgePoolForOrg } from '../../core/knowledge/pool.ts';
import { resolveAccessScope } from '../chat/shim.ts';
import { deleteConversation } from '../conversations/service.ts';
import { conversationShimHandlers } from '../conversations/shim.ts';
import {
  createCredential,
  deleteCredential,
  resolveProviderCredential,
} from '../provider_credentials/service.ts';
import {
  ensureDefaultCorpusSchema,
  fetchKnowledgeDocument,
  searchKnowledgeForOrg,
} from './service.ts';

export async function checkInboundEmailBodies(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  orgSlug: string,
  harness: {
    record: (name: string, ok: boolean, detail: string) => void;
    waitFor: (
      predicate: () => boolean | Promise<boolean>,
      timeoutMs: number,
    ) => Promise<boolean>;
    /** The harness's deterministic fake `/v1/embeddings` body. */
    embeddingsPayload: (rawBody: string) => string;
  },
): Promise<void> {
  const { record, waitFor } = harness;
  const { orgId, userId } = ctx;
  const embedServer = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: unknown) => {
      body += String(chunk);
    });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(harness.embeddingsPayload(body));
    });
  });
  await new Promise<void>((resolve) => {
    embedServer.listen(0, '127.0.0.1', resolve);
  });
  const address = embedServer.address();
  const embedPort =
    address !== null && typeof address === 'object' ? address.port : 0;
  const configPath = path.join(
    process.env.TALE_CONFIG_DIR ?? '',
    orgSlug,
    'knowledge',
    'embedding.json',
  );
  // The earlier lanes' model is restored afterwards, so the lanes that follow
  // find the organization as this one found it.
  const previousConfig = await readFile(configPath, 'utf8').catch(
    (error: unknown) => {
      console.warn('[itest] no earlier embedding config to restore:', error);
      return null;
    },
  );
  const scope = { organizationId: orgId, userId, role: 'owner' };
  const memberId = randomUUID();
  let credentialId = '';
  let conversationId = '';
  try {
    // A key for the fake endpoint — unless an earlier lane left one the
    // model already resolves (the full run), so the lane also runs alone.
    const hasKey = await resolveProviderCredential(sql, {
      organizationId: orgId,
      providerSlug: 'openai',
    }).then(
      () => true,
      () => false,
    );
    if (!hasKey) {
      credentialId = await transactSerializable(sql, (tx) =>
        createCredential(tx, scope, {
          providerSlug: 'openai',
          authMethod: 'api-key',
          name: `Email bodies probe ${memberId.slice(0, 8)}`,
          secret: 'sk-itest-email-bodies',
          isDefault: true,
        }),
      );
    }
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify({
        providerSlug: 'openai',
        model: 'itest-embed',
        dimensions: 8,
        baseUrl: `http://127.0.0.1:${embedPort}/v1`,
      }),
    );
    // Idempotent; lets the lane run alone under ITEST_LANES.
    await ensureDefaultCorpusSchema();
    // A plain member: an unassigned inbox row is admin triage only.
    await sql`
      INSERT INTO "user" ("id", "email", "name", "emailVerified", "createdAt",
                          "updatedAt")
      VALUES (${memberId}, ${`email.bodies.${memberId}@door.test`},
              'Email Bodies Member', true, ${new Date()}, ${new Date()})
    `;
    await sql`
      INSERT INTO "member" ("id", "organizationId", "userId", "role",
                            "createdAt")
      VALUES (gen_random_uuid(), ${orgId}, ${memberId}, 'member', ${new Date()})
    `;

    // The mailbox ingest — the shim handlers the sync lane dispatches.
    const handlers = conversationShimHandlers(sql, () => {
      throw new Error('the email-bodies check dispatches no connector calls');
    });
    const create =
      handlers[
        'conversations/internal_mutations:createConversationWithMessage'
      ];
    const reply =
      handlers['conversations/internal_mutations:addMessageToConversation'];
    if (!create || !reply) throw new Error('conversation shim handler missing');
    const phrase = `field sales agent ${memberId.slice(0, 8)}`;
    const html = `<p>I am applying for the <b>${phrase}</b> role.</p>`;
    const created = z
      .object({ conversationId: z.string(), messageId: z.string() })
      .parse(
        await create({
          organizationId: orgId,
          direction: 'inbound',
          channel: 'email',
          connectorName: 'imap-smtp',
          subject: 'Application',
          initialMessage: {
            sender: 'applicant@ext.test',
            content: html,
            isCustomer: true,
            metadata: {
              html,
              text: null,
              subject: 'Application',
              from: [
                { name: 'Applicant Example', address: 'applicant@ext.test' },
              ],
            },
          },
        }),
      );
    conversationId = created.conversationId;
    // Our own reply on the same thread is never queued.
    await reply({
      organizationId: orgId,
      conversationId,
      sender: 'desk@door.test',
      content: `Thank you — we received your application for ${phrase}.`,
      isCustomer: false,
    });
    const jobs = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM pgboss.job j
      JOIN app.conversation_messages m ON m.id = j.data ->> 'messageId'
      WHERE j.name = 'rag.index_message' AND m.conversation_id = ${conversationId}
    `;
    const ref = messageRef(created.messageId);
    const pool = await getKnowledgePoolForOrg(orgSlug);
    const corpusRow = async () =>
      (
        await pool.unsafe<
          {
            status: string;
            conversationId: string | null;
            chunk: string | null;
          }[]
        >(
          `SELECT d.status, d.conversation_id AS "conversationId",
                  (SELECT c.chunk_content FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.chunks c
                    WHERE c.document_id = d.id AND c.org_slug = d.org_slug
                    ORDER BY c.chunk_index LIMIT 1) AS chunk
             FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.documents d
            WHERE d.org_slug = $1 AND d.file_id = $2`,
          [orgSlug, ref],
        )
      )[0];
    const indexed = await waitFor(
      async () => (await corpusRow())?.status === 'completed',
      20_000,
    );
    const row = await corpusRow();
    record(
      'inbound email body: queued at ingest, indexed on the worker under its message ref with its conversation stamped',
      jobs[0]?.count === '1' &&
        indexed &&
        row?.conversationId === conversationId &&
        (row.chunk ?? '').includes(
          'Application — from Applicant Example <applicant@ext.test>',
        ) &&
        (row.chunk ?? '').includes(phrase) &&
        !(row.chunk ?? '').includes('<b>'),
      `jobs=${jobs[0]?.count} (want 1: the reply is never queued) indexed=${indexed} stamp=${row?.conversationId === conversationId} header=${JSON.stringify((row?.chunk ?? '').slice(0, 80))}`,
    );

    const adminScope = {
      ...(await resolveAccessScope(sql, orgId, userId)),
      userId,
    };
    const memberScope = {
      ...(await resolveAccessScope(sql, orgId, memberId)),
      userId: memberId,
    };
    // Restricted to the one ref, so the answer never depends on how the
    // rest of the corpus ranks.
    const found = async (
      access: Parameters<typeof searchKnowledgeForOrg>[1]['access'],
    ): Promise<{ refs: string[]; conversationId: string | null }> => {
      const result = await searchKnowledgeForOrg(sql, {
        organizationId: orgId,
        query: phrase,
        corpus: 'documents',
        limit: 10,
        refs: [ref],
        ...(access !== undefined ? { access } : {}),
      });
      return {
        refs: result.hits.map((hit) => hit.source.ref),
        conversationId:
          result.hits.find((hit) => hit.source.ref === ref)?.source
            .conversationId ?? null,
      };
    };
    const admin = await found({
      ...adminScope,
      includeConversationMessages: true,
    });
    const member = await found({
      ...memberScope,
      includeConversationMessages: true,
    });
    const otherDoor = await found(adminScope);
    const orgWide = await found(undefined);
    const fetched = await fetchKnowledgeDocument(sql, {
      organizationId: orgId,
      fileId: ref,
      access: { ...adminScope, includeConversationMessages: true },
    });
    record(
      'inbound email body: found and read by whoever may read its conversation, through the door that asks for bodies only',
      admin.refs.includes(ref) &&
        admin.conversationId === conversationId &&
        !member.refs.includes(ref) &&
        !otherDoor.refs.includes(ref) &&
        !orgWide.refs.includes(ref) &&
        (fetched?.text ?? '').includes(phrase) &&
        fetched?.conversationId === conversationId,
      `admin=${admin.refs.length} (want 1) member=${member.refs.length} (want 0) doorThatDidNotAsk=${otherDoor.refs.length} (want 0) orgWide=${orgWide.refs.length} (want 0) fetched=${fetched !== null}`,
    );

    await sql`UPDATE app.conversations SET status = 'spam' WHERE id = ${conversationId}`;
    const spam = await found({
      ...adminScope,
      includeConversationMessages: true,
    });
    await deleteConversation(sql, orgId, conversationId);
    conversationId = '';
    const released = await waitFor(
      async () => (await corpusRow()) === undefined,
      20_000,
    );
    record(
      'inbound email body: a spam verdict darkens it, and deleting the conversation releases its corpus rows',
      !spam.refs.includes(ref) && released,
      `spam=${spam.refs.length} (want 0) released=${released}`,
    );
  } finally {
    if (conversationId !== '') {
      await deleteConversation(sql, orgId, conversationId).catch(
        (error: unknown) => {
          console.warn('[itest] the email-bodies conversation stayed:', error);
        },
      );
    }
    if (previousConfig === null) await rm(configPath, { force: true });
    else await writeFile(configPath, previousConfig);
    if (credentialId !== '') {
      // Unused again once the earlier model is back, so the delete passes.
      await transactSerializable(sql, (tx) =>
        deleteCredential(tx, scope, credentialId),
      ).catch((error: unknown) => {
        console.warn('[itest] the email-bodies probe key stayed:', error);
      });
    }
    await sql`DELETE FROM "member" WHERE "userId" = ${memberId}`;
    await sql`DELETE FROM "user" WHERE "id" = ${memberId}`;
    await new Promise<void>((resolve) => {
      embedServer.close(() => resolve());
    });
  }
}
