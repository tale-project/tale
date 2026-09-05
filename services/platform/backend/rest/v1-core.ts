import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { defineAbilityFor } from '../../lib/permissions/ability.ts';
import { dataSourceSchema } from '../../lib/shared/schemas/common.ts';
import { getUserTeamIds } from '../auth/membership.ts';
import {
  deleteAgentForCaller,
  listAgentsForCaller,
  readAgentForCaller,
  saveAgentForCaller,
} from '../core/agents/file_actions.ts';
import {
  deleteSkillForViewer,
  listSkillsForViewer,
  readSkillForViewer,
  saveSkillForViewer,
} from '../core/skills/file_actions.ts';
import { agentErrorResponse } from '../domains/agents/errors.ts';
import {
  bulkCreateContacts,
  createContact,
  deleteContact,
  getContact,
  listContacts,
  updateContact,
  type ContactScope,
} from '../domains/contacts/service.ts';
import {
  assertDocumentsWriteRole,
  createHubDocument,
  deleteDocumentHard,
  DocumentError,
  getDocumentById,
  listHubDocumentsPage,
  readDocumentRestExtras,
  updateDocument,
  type DocumentRow,
} from '../domains/documents/service.ts';
import { searchKnowledgeForOrg } from '../domains/knowledge/service.ts';
import {
  markRagQueued,
  syncRagDocumentScope,
} from '../domains/knowledge/service.ts';
import {
  createKnowledgeEntry,
  deleteKnowledgeEntry,
  updateKnowledgeEntry,
} from '../domains/knowledge_entries/service.ts';
import {
  createProduct,
  deleteProduct,
  getProduct,
  listProducts,
  updateProduct,
  type ProductScope,
} from '../domains/products/service.ts';
import { skillErrorResponse } from '../domains/skills/errors.ts';
import { withSkillWriterLock } from '../domains/skills/writer-lock.ts';
import { addJobInTx, PRIORITY_INTERACTIVE } from '../jobs/enqueue.ts';
import { resolveOrgSlug } from '../lib/org-config.ts';
import { chargeOrgRateLimit } from '../lib/rate-limit-response.ts';
import {
  domainErrorResponse,
  formatKeysetCursor,
  pageLimit,
  parseKeysetCursor,
  readJsonBody,
  type RestEnv,
  restProjectAuth,
} from './shared.ts';

/**
 * /api/v1 core resources: contacts, products, documents (the Knowledge-Hub
 * lane), knowledge entries, knowledge search, agents and skills (the file
 * layer, reused). Thin adapters over the SAME domain services the app
 * surface uses, shaped like the 0.4 REST handlers.
 */

export function createCoreRoutes(deps: { sql: Sql }): Hono<RestEnv> {
  const app = new Hono<RestEnv>();

  const scope = (c: Context<RestEnv>): ContactScope & ProductScope => ({
    organizationId: c.get('organizationId'),
    userId: c.get('userId'),
    role: c.get('role'),
  });

  // ---- contacts -----------------------------------------------------------
  const contactInput = z.object({
    name: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    source: dataSourceSchema.optional(),
    locale: z.string().optional(),
    address: z.record(z.string(), z.unknown()).optional(),
    externalId: z.union([z.string(), z.number()]).optional(),
    tags: z.array(z.string()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    notes: z.string().optional(),
  });

  /** Keyset-paginated (`cursor` = the previous page's `continueCursor`,
   * `<updatedAt>:<id>`); `limit` 1..200, default 25. */
  app.get('/contacts', async (c) => {
    const cursor = parseKeysetCursor(c.req.query('cursor'));
    try {
      const result = await listContacts(deps.sql, scope(c), {
        ...(c.req.query('source') !== undefined
          ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- listContacts filters on the free-text column; unknown values match nothing
            { source: c.req.query('source') as never }
          : {}),
        cursor:
          cursor === null ? null : { updatedAt: cursor.at, id: cursor.id },
        limit: pageLimit(c.req.query('limit'), { fallback: 25, max: 200 }),
      });
      return c.json({
        page: result.items,
        isDone: result.nextCursor === null,
        continueCursor:
          result.nextCursor === null
            ? ''
            : formatKeysetCursor(
                result.nextCursor.updatedAt,
                result.nextCursor.id,
              ),
      });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.post('/contacts', async (c) => {
    const body = contactInput.safeParse(await readJsonBody(c));
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const id = await deps.sql.begin((tx) =>
        createContact(tx, scope(c), {
          ...body.data,
          externalId:
            body.data.externalId === undefined
              ? undefined
              : String(body.data.externalId),
          source: body.data.source ?? 'api_import',
        }),
      );
      return c.json({ id }, 201);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.post('/contacts/bulk', async (c) => {
    const body = z
      .object({
        contacts: z.array(contactInput.extend({ email: z.string() })).max(500),
      })
      .safeParse(await readJsonBody(c));
    if (!body.success) {
      return c.json({ error: 'Missing or invalid "contacts" array' }, 400);
    }
    try {
      const result = await bulkCreateContacts(
        deps.sql,
        scope(c),
        body.data.contacts,
      );
      return c.json(result, 201);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.get('/contacts/:id', async (c) => {
    try {
      const contact = await getContact(deps.sql, scope(c), c.req.param('id'));
      if (!contact) return c.json({ error: 'Contact not found' }, 404);
      return c.json(contact);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.patch('/contacts/:id', async (c) => {
    const body = contactInput.partial().safeParse(await readJsonBody(c));
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      await deps.sql.begin((tx) =>
        updateContact(tx, scope(c), c.req.param('id'), {
          ...body.data,
          externalId:
            body.data.externalId === undefined
              ? undefined
              : String(body.data.externalId),
          source: body.data.source,
        }),
      );
      const updated = await getContact(deps.sql, scope(c), c.req.param('id'));
      if (!updated) return c.json({ error: 'Contact not found' }, 404);
      return c.json(updated);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.delete('/contacts/:id', async (c) => {
    try {
      await deps.sql.begin((tx) =>
        deleteContact(tx, scope(c), c.req.param('id')),
      );
      return c.body(null, 204);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  // ---- products -----------------------------------------------------------
  const productInput = z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    imageUrl: z.string().optional(),
    stock: z.number().optional(),
    price: z.number().optional(),
    currency: z.string().optional(),
    category: z.string().optional(),
    tags: z.array(z.string()).optional(),
    status: z.string().optional(),
    externalId: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  });

  /** Keyset-paginated like /contacts; `status` and `category` narrow. */
  app.get('/products', async (c) => {
    const cursor = parseKeysetCursor(c.req.query('cursor'));
    try {
      const result = await listProducts(deps.sql, scope(c), {
        ...(c.req.query('category') !== undefined
          ? { category: c.req.query('category') ?? '' }
          : {}),
        ...(c.req.query('status') !== undefined
          ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- listProducts filters on the status column; a value outside the vocabulary matches nothing
            { status: c.req.query('status') as never }
          : {}),
        cursor:
          cursor === null ? null : { updatedAt: cursor.at, id: cursor.id },
        limit: pageLimit(c.req.query('limit'), { fallback: 25, max: 200 }),
      });
      return c.json({
        page: result.items,
        isDone: result.nextCursor === null,
        continueCursor:
          result.nextCursor === null
            ? ''
            : formatKeysetCursor(
                result.nextCursor.updatedAt,
                result.nextCursor.id,
              ),
      });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.post('/products', async (c) => {
    const body = productInput.safeParse(await readJsonBody(c));
    if (!body.success || body.data.name === undefined) {
      return c.json({ error: 'invalid body ("name" is required)' }, 400);
    }
    try {
      const id = await deps.sql.begin((tx) =>
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the service validates status/currency vocabularies
        createProduct(tx, scope(c), {
          ...body.data,
          name: body.data.name,
        } as never),
      );
      return c.json({ id }, 201);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.get('/products/:id', async (c) => {
    try {
      const product = await getProduct(deps.sql, scope(c), c.req.param('id'));
      if (!product) return c.json({ error: 'Product not found' }, 404);
      return c.json(product);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.patch('/products/:id', async (c) => {
    const body = productInput.safeParse(await readJsonBody(c));
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      await deps.sql.begin((tx) =>
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the service validates status/currency vocabularies
        updateProduct(tx, scope(c), c.req.param('id'), body.data as never),
      );
      const updated = await getProduct(deps.sql, scope(c), c.req.param('id'));
      if (!updated) return c.json({ error: 'Product not found' }, 404);
      return c.json(updated);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.delete('/products/:id', async (c) => {
    try {
      await deps.sql.begin((tx) =>
        deleteProduct(tx, scope(c), c.req.param('id')),
      );
      return c.body(null, 204);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  // ---- documents (the Knowledge-Hub lane) ---------------------------------
  // Project files are NOT addressable here (opaque 404) — they are managed
  // through the project REST family; this mirrors the 0.4 hub gate.
  const hubDocumentPayload = (
    doc: DocumentRow,
    extras: { content: string | null } | null,
  ) => ({
    id: doc.id,
    title: doc.title,
    content: extras?.content ?? null,
    fileId: doc.fileRef,
    mimeType: doc.mimeType,
    extension: doc.extension,
    sourceProvider: doc.sourceProvider,
    teamId: doc.teamId,
    folderId: doc.folderId,
    metadata: doc.metadata,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  });

  app.get('/documents', async (c) => {
    const limitRaw = Number(c.req.query('limit') ?? '25');
    try {
      const auth = await restProjectAuth(deps.sql, c);
      const result = await listHubDocumentsPage(deps.sql, auth, {
        ...(c.req.query('sourceProvider') !== undefined
          ? { sourceProvider: c.req.query('sourceProvider') ?? '' }
          : {}),
        ...(c.req.query('folderId') !== undefined
          ? { folderId: c.req.query('folderId') ?? '' }
          : {}),
        cursor: c.req.query('cursor') ?? null,
        limit: Number.isFinite(limitRaw) ? limitRaw : 25,
      });
      return c.json({
        page: result.page.map((doc) => hubDocumentPayload(doc, null)),
        isDone: result.isDone,
        continueCursor: result.continueCursor,
      });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.post('/documents', async (c) => {
    const body = z
      .object({
        title: z.string().min(1).max(512),
        content: z.string().max(5_000_000).optional(),
        fileId: z.string().max(2048).optional(),
        mimeType: z.string().max(255).optional(),
        extension: z.string().max(32).optional(),
        sourceProvider: z.string().max(64).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
        teamId: z.string().max(128).optional(),
        folderId: z.string().max(64).optional(),
      })
      .safeParse(await readJsonBody(c));
    if (!body.success) {
      return c.json({ error: 'invalid body ("title" is required)' }, 400);
    }
    try {
      const auth = await restProjectAuth(deps.sql, c);
      const id = await deps.sql.begin((tx) =>
        createHubDocument(tx, auth, body.data),
      );
      return c.json({ id }, 201);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  /** One hub document, or the opaque 404 (missing, foreign, project file). */
  const loadHubDocument = async (
    c: Context<RestEnv>,
    documentId: string,
  ): Promise<DocumentRow | Response> => {
    const auth = await restProjectAuth(deps.sql, c);
    const doc = await getDocumentById(deps.sql, auth, documentId);
    if (doc.projectId !== null) {
      return c.json({ error: 'Document not found' }, 404);
    }
    return doc;
  };

  app.get('/documents/:id', async (c) => {
    try {
      const doc = await loadHubDocument(c, c.req.param('id'));
      if (doc instanceof Response) return doc;
      const extras = await readDocumentRestExtras(deps.sql, doc.id);
      return c.json(hubDocumentPayload(doc, extras));
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.patch('/documents/:id', async (c) => {
    const body = z
      .object({
        title: z.string().min(1).max(512).optional(),
        content: z.string().max(5_000_000).nullable().optional(),
        metadata: z.record(z.string(), z.unknown()).nullable().optional(),
        mimeType: z.string().max(255).nullable().optional(),
        extension: z.string().max(32).nullable().optional(),
        sourceProvider: z.string().max(64).nullable().optional(),
        teamId: z.string().max(128).nullable().optional(),
        folderId: z.string().max(64).nullable().optional(),
      })
      .safeParse(await readJsonBody(c));
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const doc = await loadHubDocument(c, c.req.param('id'));
      if (doc instanceof Response) return doc;
      const auth = await restProjectAuth(deps.sql, c);
      const result = await deps.sql.begin((tx) =>
        updateDocument(tx, auth, { documentId: doc.id, ...body.data }),
      );
      // Same post-commit re-stamp as the app door: a team or folder change
      // moves the corpus filters, not the embeddings.
      if (
        (result.teamScopeChanged || result.folderChanged) &&
        result.fileRef !== null
      ) {
        await syncRagDocumentScope(deps.sql, auth.organizationId, doc.id);
      }
      return c.body(null, 204);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.delete('/documents/:id', async (c) => {
    try {
      const doc = await loadHubDocument(c, c.req.param('id'));
      if (doc instanceof Response) return doc;
      const auth = await restProjectAuth(deps.sql, c);
      // The SESSION delete whole — org-role write gate, the controlled-record
      // protection predicate (in_review/approved AND retained approved
      // history, `assertRecordTrashableJson` — never re-derived from `state`
      // alone), legal holds, sync stop, the audit row, then the purge.
      await deleteDocumentHard(deps.sql, auth, doc.id);
      return c.body(null, 204);
    } catch (error) {
      // Wire parity: this door has always refused protected records as 409.
      if (
        error instanceof DocumentError &&
        error.code === 'DOCUMENT_RECORD_PROTECTED'
      ) {
        return c.json(
          { error: 'DOCUMENT_RECORD_PROTECTED', message: error.message },
          409,
        );
      }
      return domainErrorResponse(c, error);
    }
  });

  app.post('/documents/:id/retry-indexing', async (c) => {
    try {
      // Write-shaped: it rewrites RAG bookkeeping and enqueues billable
      // indexing — the same matrix gate as the session Retry affordance.
      assertDocumentsWriteRole({ role: c.get('role') });
      const doc = await loadHubDocument(c, c.req.param('id'));
      if (doc instanceof Response) return doc;
      if (doc.fileRef === null) {
        // A content-only document has no blob to index through this lane.
        return c.json({ status: 'skipped' });
      }
      const files = await deps.sql<
        { id: string; skipRagIndexing: boolean | null }[]
      >`
        SELECT id, skip_rag_indexing AS "skipRagIndexing"
        FROM app.file_metadata
        WHERE org_id = ${c.get('organizationId')}
          AND storage_ref = ${doc.fileRef}
        LIMIT 1
      `;
      const file = files[0];
      if (file === undefined) return c.json({ status: 'skipped' });
      // A persisted RAG opt-out never indexes — answer honestly instead of
      // claiming 'indexing'; clearing the opt-out stays a deliberate UI act.
      if (file.skipRagIndexing === true) {
        return c.json({ status: 'skipped' });
      }
      await deps.sql.begin(async (tx) => {
        await markRagQueued(tx, file.id);
        await addJobInTx(
          tx,
          'rag.index_file',
          { fileId: file.id },
          {
            priority: PRIORITY_INTERACTIVE,
          },
        );
      });
      return c.json({ status: 'indexing' });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  // ---- knowledge search ----------------------------------------------------
  // A POST because it carries a body, not because it writes. Deliberately
  // ORG-WIDE: the API key speaks for the organization, not one member's
  // visibility (the scoped surfaces are the chat tools and the sandbox
  // bridge).
  app.post('/knowledge/search', async (c) => {
    const body = z
      .object({
        query: z.string().min(1).max(2000),
        corpus: z.enum(['documents', 'web', 'all']).optional(),
        limit: z.number().int().min(1).max(50).optional(),
        minSimilarity: z.number().min(0).max(1).optional(),
      })
      .safeParse(await readJsonBody(c));
    if (!body.success) {
      return c.json({ error: 'invalid body ("query" is required)' }, 400);
    }
    try {
      const result = await searchKnowledgeForOrg(deps.sql, {
        organizationId: c.get('organizationId'),
        query: body.data.query,
        ...(body.data.corpus !== undefined ? { corpus: body.data.corpus } : {}),
        ...(body.data.limit !== undefined ? { limit: body.data.limit } : {}),
        ...(body.data.minSimilarity !== undefined
          ? { minSimilarity: body.data.minSimilarity }
          : {}),
      });
      return c.json(result);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  // ---- knowledge entries ---------------------------------------------------
  interface RestEntryRow {
    id: string;
    topic: string;
    content: string;
    status: string;
    source: string;
    documentId: string | null;
    supersededBy: string | null;
    createdBy: string;
    createdAt: number;
    seq: number;
  }

  const entryView = (row: RestEntryRow) => ({
    id: row.id,
    topic: row.topic,
    content: row.content,
    status: row.status,
    source: row.source,
    ...(row.documentId !== null ? { documentId: row.documentId } : {}),
    ...(row.supersededBy !== null ? { supersededBy: row.supersededBy } : {}),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  });

  const ENTRY_VIEW_COLUMNS = `
    id, topic, content, status, source, document_id AS "documentId",
    superseded_by AS "supersededBy", created_by AS "createdBy",
    created_at_ms::float8 AS "createdAt", seq::float8 AS seq
  `;

  app.get('/knowledge-entries', async (c) => {
    const status = c.req.query('status') ?? 'active';
    if (status !== 'active' && status !== 'superseded') {
      return c.json({ error: '"status" must be active or superseded' }, 400);
    }
    const limitRaw = Number(c.req.query('limit') ?? '25');
    const limit = Math.min(
      Math.max(Number.isFinite(limitRaw) ? limitRaw : 25, 1),
      100,
    );
    const cursorParam = c.req.query('cursor');
    // Number('') is 0 — only a present, non-empty cursor filters the page.
    const cursor =
      cursorParam !== undefined &&
      cursorParam !== '' &&
      Number.isFinite(Number(cursorParam))
        ? Number(cursorParam)
        : null;
    const rows = await deps.sql<RestEntryRow[]>`
      SELECT ${deps.sql.unsafe(ENTRY_VIEW_COLUMNS)}
      FROM app.knowledge_entries
      WHERE org_id = ${c.get('organizationId')} AND status = ${status}
        AND deleted_at_ms IS NULL
        AND (${cursor}::bigint IS NULL OR seq < ${cursor})
      ORDER BY seq DESC
      LIMIT ${limit + 1}
    `;
    const page = rows.slice(0, limit);
    const isDone = rows.length <= limit;
    return c.json({
      page: page.map(entryView),
      isDone,
      continueCursor: isDone ? '' : String(page.at(-1)?.seq ?? ''),
    });
  });

  const entryBody = z.object({
    topic: z.string().min(1).max(200),
    content: z.string().min(1).max(100_000),
  });

  /** The per-org `knowledge:mutate` budget the in-app entry writes share —
   * answered as the standard 429 (`RATE_LIMITED` + `Retry-After`): the
   * limiter's error carries no wire code, so left inside the domain-error
   * mapping it read as a 500 outage and landed in error reporting. */
  const chargeKnowledgeMutate = (c: Context<RestEnv>) =>
    chargeOrgRateLimit(deps.sql, c, 'knowledge:mutate', c.get('organizationId'));

  const loadEntry = async (
    c: Context<RestEnv>,
    entryId: string,
  ): Promise<RestEntryRow | null> => {
    const rows = await deps.sql<RestEntryRow[]>`
      SELECT ${deps.sql.unsafe(ENTRY_VIEW_COLUMNS)}
      FROM app.knowledge_entries
      WHERE id = ${entryId}
        AND org_id = ${c.get('organizationId')}
        AND deleted_at_ms IS NULL
      LIMIT 1
    `;
    return rows[0] ?? null;
  };

  app.post('/knowledge-entries', async (c) => {
    const body = entryBody.safeParse(await readJsonBody(c));
    if (!body.success) {
      return c.json(
        { error: 'invalid body ("topic" and "content" are required)' },
        400,
      );
    }
    const limited = await chargeKnowledgeMutate(c);
    if (limited) return limited;
    try {
      const id = await createKnowledgeEntry(deps.sql, {
        organizationId: c.get('organizationId'),
        userId: c.get('userId'),
        role: c.get('role'),
        topic: body.data.topic,
        content: body.data.content,
        source: 'manual',
      });
      return c.json({ id }, 201);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.get('/knowledge-entries/:id', async (c) => {
    const entry = await loadEntry(c, c.req.param('id'));
    if (entry === null) {
      return c.json({ error: 'Knowledge entry not found' }, 404);
    }
    return c.json(entryView(entry));
  });

  /** Replace an entry's topic/content. Answers with the NEW row's id — an
   * update INSERTS the next active version and supersedes this one. */
  app.patch('/knowledge-entries/:id', async (c) => {
    const body = entryBody.safeParse(await readJsonBody(c));
    if (!body.success) {
      return c.json(
        { error: 'invalid body ("topic" and "content" are required)' },
        400,
      );
    }
    const limited = await chargeKnowledgeMutate(c);
    if (limited) return limited;
    try {
      const id = await updateKnowledgeEntry(deps.sql, {
        organizationId: c.get('organizationId'),
        userId: c.get('userId'),
        role: c.get('role'),
        entryId: c.req.param('id'),
        topic: body.data.topic,
        content: body.data.content,
      });
      return c.json({ id });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.delete('/knowledge-entries/:id', async (c) => {
    const limited = await chargeKnowledgeMutate(c);
    if (limited) return limited;
    try {
      await deleteKnowledgeEntry(deps.sql, {
        organizationId: c.get('organizationId'),
        entryId: c.req.param('id'),
        role: c.get('role'),
      });
      return c.body(null, 204);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  // ---- agents (the file layer, reused) ------------------------------------
  const agentCaller = async (c: Context<RestEnv>) => ({
    orgSlug:
      (await resolveOrgSlug(deps.sql, c.get('organizationId'))) ??
      c.get('orgSlug'),
    viewerUserId: c.get('userId'),
    isOrgAdmin: defineAbilityFor(c.get('role')).can('write', 'orgSettings'),
  });

  app.get('/agents', async (c) => {
    return c.json(await listAgentsForCaller(await agentCaller(c)));
  });

  // The file layer's coded refusals — an invalid slug, an agent the key
  // holder may not edit, a malformed file — map onto 400/403/422 exactly as
  // the app route maps them; uncaught they read as a 500 outage.
  app.get('/agents/:slug', async (c) => {
    try {
      const agent = await readAgentForCaller({
        ...(await agentCaller(c)),
        slug: c.req.param('slug'),
      });
      if (agent === null) return c.json({ error: 'Agent not found' }, 404);
      return c.json({ agent });
    } catch (error) {
      return agentErrorResponse(c, error);
    }
  });

  app.put('/agents/:slug', async (c) => {
    const body = z
      .object({
        displayName: z.string().min(1),
        description: z.string().optional(),
        instructions: z.string().optional(),
        visibility: z.enum(['private', 'org']).optional(),
      })
      .safeParse(await readJsonBody(c));
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const agent = await saveAgentForCaller({
        ...(await agentCaller(c)),
        slug: c.req.param('slug'),
        ...body.data,
      });
      return c.json({ agent });
    } catch (error) {
      return agentErrorResponse(c, error);
    }
  });

  /** Removing a resource that is not there is a 404 — the deletion
   * semantics the API reference documents, and the skills family's. */
  app.delete('/agents/:slug', async (c) => {
    try {
      const deleted = await deleteAgentForCaller({
        ...(await agentCaller(c)),
        slug: c.req.param('slug'),
      });
      if (!deleted) return c.json({ error: 'Agent not found' }, 404);
      return c.body(null, 204);
    } catch (error) {
      return agentErrorResponse(c, error);
    }
  });

  // ---- skills (the file layer, reused) -------------------------------------
  /** The key acts as its user: team skills follow the user's own teams. */
  const skillCaller = async (c: Context<RestEnv>) => ({
    orgSlug:
      (await resolveOrgSlug(deps.sql, c.get('organizationId'))) ??
      c.get('orgSlug'),
    viewer: {
      kind: 'user' as const,
      userId: c.get('userId'),
      teamIds: await getUserTeamIds(deps.sql, c.get('userId')),
      isOrgAdmin: defineAbilityFor(c.get('role')).can('write', 'orgSettings'),
    },
  });

  app.get('/skills', async (c) => {
    return c.json(await listSkillsForViewer(await skillCaller(c)));
  });

  app.get('/skills/:slug', async (c) => {
    try {
      const skill = await readSkillForViewer({
        ...(await skillCaller(c)),
        slug: c.req.param('slug'),
      });
      if (!skill) return c.json({ error: 'Skill not found' }, 404);
      return c.json(skill);
    } catch (error) {
      return skillErrorResponse(c, error);
    }
  });

  app.put('/skills/:slug', async (c) => {
    const body = z
      .object({
        description: z.string().min(1).max(1024),
        body: z.string().max(1_000_000),
        visibility: z.enum(['private', 'team', 'org']).optional(),
        teams: z.array(z.string().max(128)).max(32).optional(),
        icon: z.string().max(200).optional(),
        labels: z.array(z.string().max(100)).max(50).optional(),
      })
      .safeParse(await readJsonBody(c));
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const who = await skillCaller(c);
      const slug = c.req.param('slug');
      // Serialized with the upload lane and the app editor on the per-slug
      // writer lock (`writer_lock.ts`).
      const saved = await withSkillWriterLock(
        deps.sql,
        c.get('organizationId'),
        slug,
        () => saveSkillForViewer({ ...who, slug, ...body.data }),
      );
      return c.json(saved);
    } catch (error) {
      return skillErrorResponse(c, error);
    }
  });

  app.delete('/skills/:slug', async (c) => {
    try {
      const who = await skillCaller(c);
      const slug = c.req.param('slug');
      const deleted = await withSkillWriterLock(
        deps.sql,
        c.get('organizationId'),
        slug,
        () => deleteSkillForViewer({ ...who, slug }),
      );
      if (!deleted) return c.json({ error: 'Skill not found' }, 404);
      return c.body(null, 204);
    } catch (error) {
      return skillErrorResponse(c, error);
    }
  });

  return app;
}
