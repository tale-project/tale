import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { KnowledgeAccessScope } from '../../lib/knowledge/types.ts';
import { defineAbilityFor } from '../../lib/permissions/ability.ts';
import {
  isValidSkillSlug,
  SKILL_EDIT_VISIBILITIES,
  skillEditFields,
} from '../../lib/shared/schemas/skills.ts';
import {
  blankStringsAsAbsent,
  blankStringsAsNull,
} from '../../lib/shared/utils/blank-strings.ts';
import { boundedJsonObject } from '../../lib/shared/utils/json-bounds.ts';
import { getUserTeamIds } from '../auth/membership.ts';
import {
  CONTENT_MAX_LENGTH,
  TOPIC_MAX_LENGTH,
} from '../core/knowledge_entries/constants.ts';
import { KNOWLEDGE_SOURCE_PROVIDER } from '../core/knowledge_entries/constants.ts';
import { PRODUCT_CATEGORY_MAX } from '../core/products/field_limits.ts';
import {
  deleteSkillForViewer,
  listSkillsForViewer,
  readSkillForViewer,
  saveSkillForViewer,
} from '../core/skills/file_actions.ts';
import {
  contactBulkItemSchema,
  contactCreateSchema,
  contactExternalIdText,
  contactFieldsSchema,
} from '../domains/contacts/input-schema.ts';
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
  type DocumentIndexingState,
  type DocumentRow,
  getDocumentById,
  listHubDocumentsPage,
  readDocumentIndexing,
  readDocumentRestExtras,
  updateDocument,
} from '../domains/documents/service.ts';
import {
  KnowledgeError,
  searchKnowledgeForOrg,
} from '../domains/knowledge/service.ts';
import {
  markRagQueued,
  syncRagDocumentScope,
} from '../domains/knowledge/service.ts';
import {
  createKnowledgeEntry,
  deleteKnowledgeEntry,
  findActiveEntryForDocument,
  updateKnowledgeEntry,
} from '../domains/knowledge_entries/service.ts';
import { listUserOrganizations } from '../domains/organizations/service.ts';
import {
  productCreateSchema,
  productPatchSchema,
} from '../domains/products/input-schema.ts';
import {
  createProduct,
  deleteProduct,
  getProduct,
  listProducts,
  updateProduct,
  type ProductScope,
} from '../domains/products/service.ts';
import { PRODUCT_STATUSES } from '../domains/products/service.ts';
import { SKILL_ERROR_STATUS } from '../domains/skills/errors.ts';
import { withSkillWriterLock } from '../domains/skills/writer-lock.ts';
import { addJobInTx, PRIORITY_INTERACTIVE } from '../jobs/enqueue.ts';
import { resolveOrgSlug } from '../lib/org-config.ts';
import { chargeOrgRateLimit } from '../lib/rate-limit-response.ts';
import {
  codedRefusalResponse,
  documentDeleteRefusal,
  domainErrorResponse,
  formatKeysetCursor,
  invalidBodyResponse,
  loadRestProject,
  mintCursor,
  noQuery,
  notFound,
  PAGE_QUERY,
  parseBody,
  queryFilter,
  readIntegerCursor,
  readJsonBody,
  readKeysetCursor,
  readPageLimit,
  readQuery,
  type RestEnv,
  restProjectAuth,
} from './shared.ts';

/**
 * /api/v1 core resources: contacts, products, documents (the Knowledge-Hub
 * lane), knowledge entries, knowledge search and skills (the file
 * layer, reused). Thin adapters over the SAME domain services the app
 * surface uses, shaped like the 0.4 REST handlers.
 */

/** Bodies larger than the door's default cap, bounded here: a document's
 * inline `content` may run to 5,000,000 characters (up to four bytes each,
 * escaped), a bulk create to 500 contacts with 10,000-character notes. */
const DOCUMENT_BODY_BYTES = 32 * 1024 * 1024;
const BULK_BODY_BYTES = 8 * 1024 * 1024;
/** A skill body may run to `MAX_SKILL_BODY_BYTES` of UTF-8, and JSON
 * escaping can multiply a byte by six (`\u0001`), so the save's own byte
 * cap sits above the worst encoding of a body the schema accepts. */
const SKILL_BODY_BYTES = 4 * 1024 * 1024;

/**
 * The skills PUT body: the file layer's own field caps (`skillEditFields`)
 * with the visibilities a save may SET — never the retired `private`, so
 * a refusal cannot advertise it — and no other key (a body `slug` that
 * contradicts the URL is refused, not silently ignored).
 */
const skillEditBodySchema = z
  .object({
    ...skillEditFields,
    visibility: z.enum(SKILL_EDIT_VISIBILITIES).optional(),
  })
  .strict();

/** The contacts/products precondition: the `updatedAt` last read; a row
 * another writer moved on answers 409 `CONTACT_STALE` / `PRODUCT_STALE`. */
const expectedUpdatedAtField = {
  expectedUpdatedAt: z
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER)
    .optional(),
};

/**
 * The CRM bodies, composed with the door's one reading of a blank string:
 * on a create (and every bulk row) a blank optional field reads as left
 * out, so a CSV-shaped row imports cleanly; on a patch a blank reads as
 * `null`, which clears the field — the same clearing an explicit `null`
 * does. A blank required field (a product's `name`) keeps its own "must
 * not be blank". `""` used to be a silent no-op on one field and stored
 * as `""` on the next, and no spelling cleared a field at all.
 */
const contactCreateBody = blankStringsAsAbsent(contactCreateSchema);
const contactBulkBody = z
  .object({
    contacts: z.array(blankStringsAsAbsent(contactBulkItemSchema)).max(500),
  })
  .strict();
const contactPatchBody = blankStringsAsNull(
  contactFieldsSchema.extend(expectedUpdatedAtField),
);
const productCreateBody = blankStringsAsAbsent(productCreateSchema);
const productPatchBody = blankStringsAsNull(productPatchSchema);

export function createCoreRoutes(deps: { sql: Sql }): Hono<RestEnv> {
  const app = new Hono<RestEnv>();

  const scope = (c: Context<RestEnv>): ContactScope & ProductScope => ({
    organizationId: c.get('organizationId'),
    userId: c.get('userId'),
    role: c.get('role'),
  });

  // ---- the key holder -----------------------------------------------------
  /** Who the key acts as and where: the organization this request resolved
   * to (its slug is the `X-Organization-Slug` value a multi-org key must
   * send) and every organization the holder belongs to — no other route
   * tells a client its own slug. */
  app.get('/me', noQuery, async (c) => {
    const memberships = await listUserOrganizations(deps.sql, c.get('userId'));
    return c.json({
      user: { id: c.get('userId'), email: c.get('userEmail') },
      organization: {
        id: c.get('organizationId'),
        slug: c.get('orgSlug'),
        role: c.get('role'),
      },
      organizations: memberships.map((membership) => ({
        id: membership.organizationId,
        slug: membership.slug ?? null,
        name: membership.name,
        role: membership.role,
      })),
    });
  });

  // ---- contacts -----------------------------------------------------------
  // The shared field shape (domains/contacts/input-schema.ts), strict: an
  // unknown key answers the documented INVALID_BODY instead of vanishing.

  /** Keyset-paginated (`cursor` = the previous page's `continueCursor`, a
   * signed opaque token — `readKeysetCursor`); `limit` 1..200, default 25. */
  app.get('/contacts', async (c) => {
    const query = readQuery(c, {
      ...PAGE_QUERY,
      source: queryFilter(64).optional(),
    });
    if (query instanceof Response) return query;
    const cursor = readKeysetCursor(c, 'contacts');
    if (cursor instanceof Response) return cursor;
    const limit = readPageLimit(c, { fallback: 25, max: 200 });
    if (limit instanceof Response) return limit;
    try {
      const result = await listContacts(deps.sql, scope(c), {
        ...(query.source !== undefined
          ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- listContacts filters on the free-text column; unknown values match nothing
            { source: query.source as never }
          : {}),
        cursor:
          cursor === null ? null : { updatedAt: cursor.at, id: cursor.id },
        limit,
      });
      return c.json({
        page: result.items,
        isDone: result.nextCursor === null,
        continueCursor:
          result.nextCursor === null
            ? ''
            : mintCursor(
                c,
                'contacts',
                formatKeysetCursor(
                  result.nextCursor.updatedAt,
                  result.nextCursor.id,
                ),
              ),
      });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.post('/contacts', async (c) => {
    const body = await parseBody(c, contactCreateBody);
    if (body instanceof Response) return body;
    try {
      const id = await deps.sql.begin((tx) =>
        createContact(tx, scope(c), {
          ...body,
          externalId: contactExternalIdText(body.externalId),
          source: body.source ?? 'api_import',
        }),
      );
      return c.json({ id }, 201);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.post('/contacts/bulk', async (c) => {
    const body = await parseBody(c, contactBulkBody, {
      maxBytes: BULK_BODY_BYTES,
    });
    if (body instanceof Response) return body;
    try {
      const result = await bulkCreateContacts(
        deps.sql,
        scope(c),
        body.contacts,
      );
      return c.json(result, 201);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  /** The live contact, or the documented 404. A DELETE trashes the row
   * (governance owns the hard erase), and the directory hides trash — so
   * this door does too: a trashed contact reads, patches and deletes as
   * absent, the way the reference promises "404 when it is gone". */
  const loadLiveContact = async (
    c: Context<RestEnv>,
    contactId: string,
  ): Promise<Awaited<ReturnType<typeof getContact>> | Response> => {
    const contact = await getContact(deps.sql, scope(c), contactId);
    if (contact.lifecycleStatus === 'trashed') {
      return notFound(c, 'Contact not found', 'CONTACT_NOT_FOUND');
    }
    return contact;
  };

  app.get('/contacts/:id', noQuery, async (c) => {
    try {
      const contact = await loadLiveContact(c, c.req.param('id'));
      if (contact instanceof Response) return contact;
      return c.json(contact);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  /** Partial update, answering the contact as it now stands. `null` clears
   * an optional field (a blank string reads as `null`); `metadata` merges
   * per RFC 7396 and `address` is replaced whole. */
  app.patch('/contacts/:id', async (c) => {
    const body = await parseBody(c, contactPatchBody);
    if (body instanceof Response) return body;
    try {
      const current = await loadLiveContact(c, c.req.param('id'));
      if (current instanceof Response) return current;
      await deps.sql.begin((tx) =>
        updateContact(tx, scope(c), current.id, {
          ...body,
          externalId: contactExternalIdText(body.externalId),
          source: body.source,
        }),
      );
      const updated = await getContact(deps.sql, scope(c), current.id);
      return c.json(updated);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.delete('/contacts/:id', async (c) => {
    try {
      const current = await loadLiveContact(c, c.req.param('id'));
      if (current instanceof Response) return current;
      await deps.sql.begin((tx) => deleteContact(tx, scope(c), current.id));
      return c.body(null, 204);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  // ---- products -----------------------------------------------------------
  // The shared field shape (domains/products/input-schema.ts), strict and
  // capped at the domain's own limits; the patch also takes the contacts
  // precondition (`expectedUpdatedAt`).

  /** Keyset-paginated like /contacts; `status` and `category` narrow. */
  app.get('/products', async (c) => {
    const query = readQuery(c, {
      ...PAGE_QUERY,
      category: queryFilter(PRODUCT_CATEGORY_MAX).optional(),
      status: z.enum(PRODUCT_STATUSES).optional(),
    });
    if (query instanceof Response) return query;
    const cursor = readKeysetCursor(c, 'products');
    if (cursor instanceof Response) return cursor;
    const limit = readPageLimit(c, { fallback: 25, max: 200 });
    if (limit instanceof Response) return limit;
    try {
      const result = await listProducts(deps.sql, scope(c), {
        ...(query.category !== undefined ? { category: query.category } : {}),
        ...(query.status !== undefined ? { status: query.status } : {}),
        cursor:
          cursor === null ? null : { updatedAt: cursor.at, id: cursor.id },
        limit,
      });
      return c.json({
        page: result.items,
        isDone: result.nextCursor === null,
        continueCursor:
          result.nextCursor === null
            ? ''
            : mintCursor(
                c,
                'products',
                formatKeysetCursor(
                  result.nextCursor.updatedAt,
                  result.nextCursor.id,
                ),
              ),
      });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.post('/products', async (c) => {
    const body = await parseBody(c, productCreateBody);
    if (body instanceof Response) return body;
    try {
      const id = await deps.sql.begin((tx) =>
        createProduct(tx, scope(c), body),
      );
      return c.json({ id }, 201);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.get('/products/:id', noQuery, async (c) => {
    try {
      const product = await getProduct(deps.sql, scope(c), c.req.param('id'));
      if (!product)
        return notFound(c, 'Product not found', 'PRODUCT_NOT_FOUND');
      return c.json(product);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  /** Partial update, answering the product as it now stands. `null` clears
   * an optional field (a blank string reads as `null`; a blank `name` is
   * refused); `metadata` merges per RFC 7396. */
  app.patch('/products/:id', async (c) => {
    const body = await parseBody(c, productPatchBody);
    if (body instanceof Response) return body;
    try {
      await deps.sql.begin((tx) =>
        updateProduct(tx, scope(c), c.req.param('id'), body),
      );
      const updated = await getProduct(deps.sql, scope(c), c.req.param('id'));
      if (!updated)
        return notFound(c, 'Product not found', 'PRODUCT_NOT_FOUND');
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
    indexing: DocumentIndexingState | undefined,
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
    // Where a file-backed document stands in the search corpus — absent
    // for a content-only document (never indexed) and for a blob the
    // platform does not track — so a client can poll after a create or a
    // `retry-indexing` instead of sleeping blind.
    ...(indexing !== undefined ? { indexing } : {}),
  });

  /** The indexing state of every file-backed document on a page, by blob. */
  const indexingOf = (c: Context<RestEnv>, docs: readonly DocumentRow[]) =>
    readDocumentIndexing(deps.sql, c.get('organizationId'), [
      ...new Set(
        docs
          .map((doc) => doc.fileRef)
          .filter((ref): ref is string => ref !== null),
      ),
    ]);

  /** The active knowledge entry a `knowledge`-sourced document backs, when
   * one does: such a document is the entry's own storage, and the entry's
   * delete (which retires the chain and trashes the document) is the
   * sanctioned path — a document door refuses to retire it sideways. */
  const knowledgeEntryBehind = async (
    c: Context<RestEnv>,
    doc: DocumentRow,
  ): Promise<Response | null> => {
    if (doc.sourceProvider !== KNOWLEDGE_SOURCE_PROVIDER) return null;
    const entry = await findActiveEntryForDocument(
      deps.sql,
      c.get('organizationId'),
      doc.id,
    );
    if (entry === null) return null;
    return c.json(
      {
        error: `This document backs the knowledge entry "${entry.topic}" (${entry.id}); delete or update the entry instead.`,
        code: 'DOCUMENT_HAS_KNOWLEDGE_ENTRY',
        data: { entryId: entry.id },
      },
      409,
    );
  };

  app.get('/documents', async (c) => {
    const query = readQuery(c, {
      ...PAGE_QUERY,
      sourceProvider: queryFilter(64).optional(),
      folderId: queryFilter(128).optional(),
    });
    if (query instanceof Response) return query;
    // The service decodes the `<createdAt>:<id>` position itself; the
    // signature is checked here so a token this list never answered is
    // refused, never read as page one.
    const cursor = readKeysetCursor(c, 'documents');
    if (cursor instanceof Response) return cursor;
    const limit = readPageLimit(c, { fallback: 25, max: 100 });
    if (limit instanceof Response) return limit;
    try {
      const auth = await restProjectAuth(deps.sql, c);
      const result = await listHubDocumentsPage(deps.sql, auth, {
        ...(query.sourceProvider !== undefined
          ? { sourceProvider: query.sourceProvider }
          : {}),
        ...(query.folderId !== undefined ? { folderId: query.folderId } : {}),
        cursor:
          cursor === null ? null : formatKeysetCursor(cursor.at, cursor.id),
        limit,
      });
      const indexing = await indexingOf(c, result.page);
      return c.json({
        page: result.page.map((doc) =>
          hubDocumentPayload(
            doc,
            null,
            doc.fileRef === null ? undefined : indexing.get(doc.fileRef),
          ),
        ),
        isDone: result.isDone,
        continueCursor:
          result.continueCursor === ''
            ? ''
            : mintCursor(c, 'documents', result.continueCursor),
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
        metadata: boundedJsonObject().optional(),
        teamId: z.string().max(128).optional(),
        folderId: z.string().max(64).optional(),
      })
      .strict()
      .safeParse(await readJsonBody(c, { maxBytes: DOCUMENT_BODY_BYTES }));
    if (!body.success) {
      return invalidBodyResponse(c, body.error);
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

  /** One hub document, or the opaque 404 (missing, foreign, project file,
   * or a row that left the active lifecycle — trashed, or expired by a
   * project cascade and waiting for the retention sweep). */
  const loadHubDocument = async (
    c: Context<RestEnv>,
    documentId: string,
  ): Promise<DocumentRow | Response> => {
    const auth = await restProjectAuth(deps.sql, c);
    const doc = await getDocumentById(deps.sql, auth, documentId);
    if (
      doc.projectId !== null ||
      (doc.lifecycleStatus ?? 'active') !== 'active'
    ) {
      return notFound(c, 'Document not found', 'DOCUMENT_NOT_FOUND');
    }
    return doc;
  };

  app.get('/documents/:id', noQuery, async (c) => {
    try {
      const doc = await loadHubDocument(c, c.req.param('id'));
      if (doc instanceof Response) return doc;
      const extras = await readDocumentRestExtras(deps.sql, doc.id);
      const indexing = await indexingOf(c, [doc]);
      return c.json(
        hubDocumentPayload(
          doc,
          extras,
          doc.fileRef === null ? undefined : indexing.get(doc.fileRef),
        ),
      );
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  /** Partial update. Answers 200 with the document as it now stands (the
   * GET view) — a client that sent `expectedUpdatedAt` needs the new
   * `updatedAt` for its next write, which a 204 could never carry. */
  app.patch('/documents/:id', async (c) => {
    const body = z
      .object({
        title: z.string().min(1).max(512).optional(),
        content: z.string().max(5_000_000).nullable().optional(),
        metadata: boundedJsonObject().nullable().optional(),
        mimeType: z.string().max(255).nullable().optional(),
        extension: z.string().max(32).nullable().optional(),
        sourceProvider: z.string().max(64).nullable().optional(),
        teamId: z.string().max(128).nullable().optional(),
        folderId: z.string().max(64).nullable().optional(),
        // The contacts/products precondition: the `updatedAt` last read;
        // a document another writer moved on answers 409 DOCUMENT_STALE.
        expectedUpdatedAt: z.number().int().min(0).optional(),
      })
      .strict()
      .safeParse(await readJsonBody(c, { maxBytes: DOCUMENT_BODY_BYTES }));
    if (!body.success) {
      return invalidBodyResponse(c, body.error);
    }
    try {
      const doc = await loadHubDocument(c, c.req.param('id'));
      if (doc instanceof Response) return doc;
      // A knowledge entry's backing document keeps its content and identity
      // through the entry (a supersede rewrites them); the entry door is
      // the way to change what it says.
      if (
        body.data.title !== undefined ||
        body.data.content !== undefined ||
        body.data.mimeType !== undefined ||
        body.data.extension !== undefined
      ) {
        const backing = await knowledgeEntryBehind(c, doc);
        if (backing) return backing;
      }
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
      const updated = await getDocumentById(deps.sql, auth, doc.id);
      const extras = await readDocumentRestExtras(deps.sql, updated.id);
      const indexing = await indexingOf(c, [updated]);
      return c.json(
        hubDocumentPayload(
          updated,
          extras,
          updated.fileRef === null ? undefined : indexing.get(updated.fileRef),
        ),
      );
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.delete('/documents/:id', async (c) => {
    try {
      const doc = await loadHubDocument(c, c.req.param('id'));
      if (doc instanceof Response) return doc;
      // Deleting an entry's backing document would retire the whole
      // knowledge chain sideways, with no warning — the entry's own delete
      // is the documented path, so this door refuses instead.
      const backing = await knowledgeEntryBehind(c, doc);
      if (backing) return backing;
      const auth = await restProjectAuth(deps.sql, c);
      // The SESSION delete whole — org-role write gate, the controlled-record
      // protection predicate (in_review/approved AND retained approved
      // history, `assertRecordTrashableJson` — never re-derived from `state`
      // alone), legal holds, sync stop, the audit row, then the purge.
      await deleteDocumentHard(deps.sql, auth, doc.id);
      return c.body(null, 204);
    } catch (error) {
      return documentDeleteRefusal(c, error);
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
        return c.json({ status: 'skipped', reason: 'content-only' });
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
      if (file === undefined) {
        return c.json({ status: 'skipped', reason: 'untracked-blob' });
      }
      // A persisted RAG opt-out never indexes — answer honestly instead of
      // claiming 'indexing'; clearing the opt-out stays a deliberate UI act.
      if (file.skipRagIndexing === true) {
        return c.json({ status: 'skipped', reason: 'rag-opt-out' });
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
  // Search is read-only. A key acts as its user: a project URL searches
  // only that project's files; the global URL searches visible Hub teams
  // and registered websites without admitting project or email attachments.
  const knowledgeSearchBody = z
    .object({
      // Trimmed before the length check: a whitespace-only query is a
      // mistake to name, not a search that answers nothing.
      query: z.string().trim().min(1).max(2000),
      corpus: z.enum(['documents', 'web', 'all']).optional(),
      limit: z.number().int().min(1).max(50).optional(),
      minSimilarity: z.number().min(0).max(1).optional(),
    })
    .strict();
  const projectKnowledgeSearchBody = knowledgeSearchBody.extend({
    corpus: z.literal('documents').optional(),
  });
  /** What a 503 from the embedding provider asks a consumer to wait —
   * advisory, in whole seconds, the way the rate-limits page's own 429
   * speaks. */
  const EMBEDDING_RETRY_AFTER_SECONDS = '5';
  const search = async (c: Context<RestEnv>, projectId: string | null) => {
    const body = (
      projectId === null ? knowledgeSearchBody : projectKnowledgeSearchBody
    ).safeParse(await readJsonBody(c));
    if (!body.success) {
      return invalidBodyResponse(c, body.error);
    }
    try {
      const auth = await restProjectAuth(deps.sql, c);
      let access: KnowledgeAccessScope;
      if (projectId !== null) {
        const project = await loadRestProject(deps.sql, auth, projectId);
        access = {
          userId: auth.userId,
          teamIds: [],
          projectIds: [project.id],
          includeHub: false,
          includeConversationScoped: false,
          archivedProjectIds: project.archivedAt === null ? [] : [project.id],
        };
      } else {
        access = {
          userId: auth.userId,
          teamIds: [
            ...new Set([`org_${auth.organizationId}`, ...auth.teamIds]),
          ],
          projectIds: [],
          includeHub: true,
          includeConversationScoped: false,
        };
      }
      const result = await searchKnowledgeForOrg(deps.sql, {
        organizationId: c.get('organizationId'),
        query: body.data.query,
        corpus: projectId === null ? (body.data.corpus ?? 'all') : 'documents',
        access,
        ...(body.data.limit !== undefined ? { limit: body.data.limit } : {}),
        ...(body.data.minSimilarity !== undefined
          ? { minSimilarity: body.data.minSimilarity }
          : {}),
      });
      return c.json(result);
    } catch (error) {
      // The domain reports a missing embedding model as its 503; on this
      // door that is the documented 409 — the organization's state refuses
      // the search until an admin configures a model — never the 500 an
      // unmapped 5xx domain error used to become. A provider account
      // refusal (balance spent, plan excludes the model) is the same kind
      // of fact — an admin must act, waiting fixes nothing — so it answers
      // the same 409, NEVER a 429 the consumer would back off and retry.
      if (
        error instanceof KnowledgeError &&
        (error.code === 'EMBEDDING_NOT_CONFIGURED' ||
          error.code === 'EMBEDDING_CREDIT_EXHAUSTED' ||
          error.code === 'EMBEDDING_CREDENTIAL_REJECTED')
      ) {
        return c.json({ error: error.message, code: error.code }, 409);
      }
      // Any other provider-side failure is a dependency outage: the
      // documented 503, not the bare 500 an unmapped 5xx domain error
      // becomes and not a 4xx blaming the caller — with the wait the
      // retry-with-backoff guidance names.
      if (
        error instanceof KnowledgeError &&
        error.code === 'EMBEDDING_UPSTREAM_ERROR'
      ) {
        return c.json({ error: error.message, code: error.code }, 503, {
          'retry-after': EMBEDDING_RETRY_AFTER_SECONDS,
        });
      }
      return domainErrorResponse(c, error);
    }
  };
  app.post('/knowledge/search', (c) => search(c, null));
  app.post('/projects/:id/knowledge/search', (c) =>
    search(c, c.req.param('id')),
  );

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
    const query = readQuery(c, {
      ...PAGE_QUERY,
      status: z.enum(['active', 'superseded']).optional(),
    });
    if (query instanceof Response) return query;
    const status = query.status ?? 'active';
    const limit = readPageLimit(c, { fallback: 25, max: 100 });
    if (limit instanceof Response) return limit;
    const cursor = readIntegerCursor(c, 'knowledge-entries');
    if (cursor instanceof Response) return cursor;
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
    const last = page.at(-1);
    return c.json({
      page: page.map(entryView),
      isDone,
      continueCursor:
        isDone || last === undefined
          ? ''
          : mintCursor(c, 'knowledge-entries', String(last.seq)),
    });
  });

  /** The one cap set the domain enforces (`validate`), so the schema
   * refuses with `INVALID_BODY` naming the field instead of the domain's
   * bare `KNOWLEDGE_ENTRY_TOPIC_TOO_LONG`; unknown keys are refused too. */
  const entryBody = z
    .object({
      topic: z.string().min(1).max(TOPIC_MAX_LENGTH),
      content: z.string().min(1).max(CONTENT_MAX_LENGTH),
    })
    .strict();

  /** The per-org `knowledge:mutate` budget the in-app entry writes share —
   * answered as the standard 429 (`RATE_LIMITED` + `Retry-After`): the
   * limiter's error carries no wire code, so left inside the domain-error
   * mapping it read as a 500 outage and landed in error reporting. */
  const chargeKnowledgeMutate = (c: Context<RestEnv>) =>
    chargeOrgRateLimit(
      deps.sql,
      c,
      'knowledge:mutate',
      c.get('organizationId'),
    );

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
      return invalidBodyResponse(c, body.error);
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

  app.get('/knowledge-entries/:id', noQuery, async (c) => {
    const entry = await loadEntry(c, c.req.param('id'));
    if (entry === null) {
      return notFound(c, 'Entry not found', 'KNOWLEDGE_ENTRY_NOT_FOUND');
    }
    return c.json(entryView(entry));
  });

  /** Replace an entry's topic/content. Answers with the NEW row's id — an
   * update INSERTS the next active version and supersedes this one. */
  app.patch('/knowledge-entries/:id', async (c) => {
    const body = entryBody.safeParse(await readJsonBody(c));
    if (!body.success) {
      return invalidBodyResponse(c, body.error);
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

  // ---- skills (the file layer, reused) -------------------------------------
  /** The key acts as its user: team skills follow the user's own teams. */
  const skillCaller = async (c: Context<RestEnv>) => ({
    orgSlug:
      (await resolveOrgSlug(deps.sql, c.get('organizationId'))) ??
      c.get('orgSlug'),
    viewer: {
      kind: 'user' as const,
      userId: c.get('userId'),
      teamIds: await getUserTeamIds(
        deps.sql,
        c.get('organizationId'),
        c.get('userId'),
      ),
      isOrgAdmin: defineAbilityFor(c.get('role')).can('write', 'orgSettings'),
    },
  });

  app.get('/skills', noQuery, async (c) => {
    return c.json(await listSkillsForViewer(await skillCaller(c)));
  });

  // A slug that could never name a bundle reads as absent on the reads and
  // the delete — the 404 every family answers for a resource that is not
  // there — while a PUT, which would CREATE it, says what is wrong with it.
  app.get('/skills/:slug', noQuery, async (c) => {
    const slug = c.req.param('slug');
    if (!isValidSkillSlug(slug)) {
      return notFound(c, 'Skill not found', 'SKILL_NOT_FOUND');
    }
    try {
      const skill = await readSkillForViewer({
        ...(await skillCaller(c)),
        slug,
      });
      if (!skill) return notFound(c, 'Skill not found', 'SKILL_NOT_FOUND');
      return c.json(skill);
    } catch (error) {
      return codedRefusalResponse(c, error, SKILL_ERROR_STATUS);
    }
  });

  app.put('/skills/:slug', async (c) => {
    const body = await parseBody(c, skillEditBodySchema, {
      maxBytes: SKILL_BODY_BYTES,
    });
    if (body instanceof Response) return body;
    // The file layer trusts team ids (the app's library only offers real
    // ones); a machine caller can send anything, so they are checked here —
    // a share with a team that does not exist is a 400 naming the ids.
    if (body.teams !== undefined && body.teams.length > 0) {
      const known = await deps.sql<{ id: string }[]>`
        SELECT "id" FROM "team"
        WHERE "organizationId" = ${c.get('organizationId')}
          AND "id" = ANY(${body.teams})
      `;
      const knownIds = new Set(known.map((row) => row.id));
      const unknown = body.teams.filter((id) => !knownIds.has(id));
      if (unknown.length > 0) {
        return c.json(
          {
            error: `Unknown team ids: ${unknown.join(', ')}`,
            code: 'SKILL_TEAM_UNKNOWN',
          },
          400,
        );
      }
    }
    // RFC 9110 §13.1.2: `If-None-Match: *` asks for a pure create — the
    // write happens only when nothing is stored under the slug. No entity
    // tag is issued, so a tag list can match nothing and the write goes
    // ahead, as the RFC has it.
    const createOnly = c.req.header('if-none-match')?.trim() === '*';
    try {
      const who = await skillCaller(c);
      const slug = c.req.param('slug');
      // Serialized with the upload lane and the app editor on the per-slug
      // writer lock (`writer_lock.ts`); the create-only check runs inside
      // it, so two racing creates cannot both win.
      const saved = await withSkillWriterLock(
        deps.sql,
        c.get('organizationId'),
        slug,
        () => saveSkillForViewer({ ...who, slug, createOnly, ...body }),
      );
      return c.json(saved);
    } catch (error) {
      return codedRefusalResponse(c, error, SKILL_ERROR_STATUS);
    }
  });

  app.delete('/skills/:slug', async (c) => {
    const slug = c.req.param('slug');
    if (!isValidSkillSlug(slug)) {
      return notFound(c, 'Skill not found', 'SKILL_NOT_FOUND');
    }
    try {
      const who = await skillCaller(c);
      const deleted = await withSkillWriterLock(
        deps.sql,
        c.get('organizationId'),
        slug,
        () => deleteSkillForViewer({ ...who, slug }),
      );
      if (!deleted) return notFound(c, 'Skill not found', 'SKILL_NOT_FOUND');
      return c.body(null, 204);
    } catch (error) {
      return codedRefusalResponse(c, error, SKILL_ERROR_STATUS);
    }
  });

  return app;
}
