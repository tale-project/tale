/** Real-Postgres, real-worker proof of indexed inbound email bodies (#3015):
 * the mailbox ingest queues `rag.index_message` in the insert's own
 * transaction, the live worker indexes the body under its message ref with
 * its conversation stamped, retrieval serves it to whoever may read that
 * conversation — through the door that asks for bodies, and no other — the
 * organization's PII policy masks the sender's address in the chunk header
 * and the stored name as well as the body, a spam verdict releases the
 * corpus rows and lifting it indexes them again, and deleting the
 * conversation releases them. Needs no object store: a message has no
 * bytes. */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { messageRef } from '../../../lib/knowledge/message-ref.ts';
import { PRIVATE_KNOWLEDGE_SCHEMA } from '../../../lib/knowledge/types.ts';
import { NO_SUBJECT } from '../../core/conversations/ingest/constants.ts';
import { getKnowledgePoolForOrg } from '../../core/knowledge/pool.ts';
import { clearOrgConfigCaches } from '../../lib/org-config.ts';
import { resolveAccessScope } from '../chat/shim.ts';
import {
  deleteConversation,
  updateConversation,
} from '../conversations/service.ts';
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
  const piiPolicyPath = path.join(
    process.env.TALE_CONFIG_DIR ?? '',
    orgSlug,
    'governance',
    'pii-config.yml',
  );
  const scope = { organizationId: orgId, userId, role: 'owner' };
  const memberId = randomUUID();
  let credentialId = '';
  let conversationId = '';
  let maskedConversationId = '';
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
    const corpusRowOf = async (fileId: string) =>
      (
        await pool.unsafe<
          {
            status: string;
            conversationId: string | null;
            filename: string | null;
            chunk: string | null;
          }[]
        >(
          `SELECT d.status, d.conversation_id AS "conversationId", d.filename,
                  (SELECT string_agg(c.chunk_content, E'\n' ORDER BY c.chunk_index)
                     FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.chunks c
                    WHERE c.document_id = d.id AND c.org_slug = d.org_slug)
                    AS chunk
             FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.documents d
            WHERE d.org_slug = $1 AND d.file_id = $2`,
          [orgSlug, fileId],
        )
      )[0];
    const corpusRow = () => corpusRowOf(ref);
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
        spender: { userId, agentSlug: '__embedding__' },
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

    // The organization's PII policy reaches the chunk header and the
    // stored name, not just the body: the sender's address never reaches
    // the embedding provider or the corpus.
    await mkdir(path.dirname(piiPolicyPath), { recursive: true });
    await writeFile(
      piiPolicyPath,
      ['enabled: true', 'mode: mask', 'enabledPatterns:', '  - email'].join(
        '\n',
      ),
    );
    clearOrgConfigCaches();
    const maskedAddress = `pii.${memberId.slice(0, 8)}@ext.test`;
    const maskedBody = `<p>Please reply to ${maskedAddress} about the ${phrase} role.</p>`;
    const masked = z
      .object({ conversationId: z.string(), messageId: z.string() })
      .parse(
        await create({
          organizationId: orgId,
          direction: 'inbound',
          channel: 'email',
          connectorName: 'imap-smtp',
          // No subject, as the mail lane stores one: the stored name is
          // then who wrote — the address the policy must mask.
          subject: NO_SUBJECT,
          initialMessage: {
            sender: maskedAddress,
            content: maskedBody,
            isCustomer: true,
            metadata: {
              html: maskedBody,
              text: null,
              from: [{ name: 'Pii Applicant', address: maskedAddress }],
            },
          },
        }),
      );
    maskedConversationId = masked.conversationId;
    const maskedRef = messageRef(masked.messageId);
    const maskedIndexed = await waitFor(
      async () => (await corpusRowOf(maskedRef))?.status === 'completed',
      20_000,
    );
    const maskedRow = await corpusRowOf(maskedRef);
    const maskedStored = `${maskedRow?.filename ?? ''}\n${maskedRow?.chunk ?? ''}`;
    await rm(piiPolicyPath, { force: true });
    clearOrgConfigCaches();
    record(
      "inbound email body: a mask PII policy keeps the sender's address out of the header, the chunks and the stored name",
      maskedIndexed &&
        (maskedRow?.chunk ?? '').includes('Email from Pii Applicant') &&
        (maskedRow?.filename ?? '').includes('Email from Pii Applicant') &&
        maskedStored.includes('[EMAIL]') &&
        !maskedStored.includes(maskedAddress),
      `indexed=${maskedIndexed} raw=${maskedStored.includes(maskedAddress)} (want false) token=${maskedStored.includes('[EMAIL]')} filename=${JSON.stringify(maskedRow?.filename ?? '')}`,
    );

    // A spam verdict releases the copy (never kept dark at rest); lifting
    // it indexes the body again.
    const flip = (status: 'spam' | 'open') =>
      sql.begin((tx) =>
        updateConversation(tx, orgId, conversationId, { status }, { userId }),
      );
    await flip('spam');
    const spam = await found({
      ...adminScope,
      includeConversationMessages: true,
    });
    const spamReleased = await waitFor(
      async () => (await corpusRow()) === undefined,
      20_000,
    );
    await flip('open');
    const reindexed = await waitFor(
      async () => (await corpusRow())?.status === 'completed',
      20_000,
    );
    await deleteConversation(sql, orgId, conversationId);
    conversationId = '';
    const released = await waitFor(
      async () => (await corpusRow()) === undefined,
      20_000,
    );
    record(
      'inbound email body: a spam verdict releases it, lifting the verdict indexes it again, and deleting the conversation releases its corpus rows',
      !spam.refs.includes(ref) && spamReleased && reindexed && released,
      `spam=${spam.refs.length} (want 0) spamReleased=${spamReleased} reindexed=${reindexed} released=${released}`,
    );
  } finally {
    await rm(piiPolicyPath, { force: true });
    clearOrgConfigCaches();
    if (maskedConversationId !== '') {
      await deleteConversation(sql, orgId, maskedConversationId).catch(
        (error: unknown) => {
          console.warn(
            '[itest] the email-bodies PII conversation stayed:',
            error,
          );
        },
      );
    }
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
