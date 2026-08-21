/**
 * Documents REST API handlers.
 *
 * Endpoints:
 *   GET    /api/v1/documents          — List documents (paginated)
 *   POST   /api/v1/documents          — Create document
 *   GET    /api/v1/documents/:id      — Get document by ID
 *   PATCH  /api/v1/documents/:id      — Update document
 *   DELETE /api/v1/documents/:id      — Delete document
 *   POST   /api/v1/documents/:id/retry-indexing — Retry RAG indexing
 */

import { internal } from '../_generated/api';
import {
  extractPathParts,
  jsonCreated,
  jsonError,
  jsonNoContent,
  jsonOk,
  parseIntParam,
  withRestAuth,
} from '../lib/rest/helpers';
import { toId } from '../lib/type_cast_helpers';

const PREFIX = '/api/v1/documents/';

export const listDocuments = withRestAuth('rest:api', async (rc, request) => {
  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor') ?? null;
  const limit = parseIntParam(url, 'limit', 25);
  const sourceProvider = url.searchParams.get('sourceProvider') ?? undefined;

  const result = await rc.ctx.runQuery(
    internal.documents.internal_queries.queryDocuments,
    {
      organizationId: rc.org.organizationId,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- user input validated at runtime
      sourceProvider: sourceProvider as
        | 'upload'
        | 'onedrive'
        | 'sharepoint'
        | 'agent'
        | undefined,
      paginationOpts: { numItems: limit, cursor },
    },
  );

  // REST is a Knowledge Hub surface: project-scoped documents are managed
  // through the project UI/APIs and are not addressable here. Filtered
  // post-pagination (the shared internal query also feeds the OneDrive
  // prune scan, which must keep seeing project-attached synced docs), so a
  // page may run short of `limit` — same trade as the in-app listings.
  return jsonOk({
    ...result,
    page: result.page.filter((doc) => doc.projectId == null),
  });
});

export const createDocument = withRestAuth('rest:api', async (rc, request) => {
  const body = await request.json();

  const documentId = await rc.ctx.runMutation(
    internal.documents.internal_mutations.createDocument,
    {
      organizationId: rc.org.organizationId,
      title: body.title,
      content: body.content,
      fileId: body.fileId,
      mimeType: body.mimeType,
      extension: body.extension,
      sourceProvider: body.sourceProvider,
      metadata: body.metadata,
      teamId: body.teamId,
      folderId: body.folderId,
      createdBy: rc.user.userId,
    },
  );

  // Coverage: a REST-created document with a backing blob must have a
  // fileMetadata row so its RAG indexing status has a canonical home
  // (documents.ragInfo is being retired in favor of fileMetadata.ragStatus).
  // Every other creation path (UI upload, connectors, WebDAV, agent writes)
  // already does this; REST was the one gap. Mirrors createDocumentFromUpload:
  // saveFileMetadata (idempotent on by_storageId, schedules RAG upload) then
  // linkDocumentToFile (sets source from the doc's provider).
  if (body.fileId) {
    const storageId = toId<'_storage'>(body.fileId);
    const meta = await rc.ctx.runQuery(
      internal.file_metadata.internal_queries.getStorageMetadata,
      { storageId },
    );
    await rc.ctx.runMutation(
      internal.file_metadata.internal_mutations.saveFileMetadata,
      {
        organizationId: rc.org.organizationId,
        storageId,
        fileName: body.title ?? 'document',
        contentType:
          body.mimeType ?? meta?.contentType ?? 'application/octet-stream',
        size: meta?.size ?? 0,
        uploadedBy: rc.user.userId,
      },
    );
    await rc.ctx.runMutation(
      internal.file_metadata.internal_mutations.linkDocumentToFile,
      { storageId, documentId },
    );
  }

  return jsonCreated({ id: documentId });
});

export const getDocument = withRestAuth('rest:api', async (rc, request) => {
  const url = new URL(request.url);
  const { id } = extractPathParts(url, PREFIX);

  if (!id) {
    return jsonError('Missing document ID', 400);
  }

  const document = await rc.ctx.runQuery(
    internal.documents.internal_queries.getDocumentByIdRaw,
    {
      documentId: toId<'documents'>(id),
      callerOrgId: rc.org.organizationId,
    },
  );

  if (!document) {
    return jsonError('Document not found', 404);
  }

  // Project files are not addressable via the hub REST API (opaque 404 —
  // don't reveal that an inaccessible document exists).
  if (document.projectId != null) {
    return jsonError('Document not found', 404);
  }

  return jsonOk(document);
});

export const patchDocument = withRestAuth('rest:api', async (rc, request) => {
  const url = new URL(request.url);
  const { id } = extractPathParts(url, PREFIX);

  if (!id) {
    return jsonError('Missing document ID', 400);
  }

  const body = await request.json();

  // Project files are not editable via the hub REST API. Opaque 404, same
  // as GET — the shared internal mutation stays open for sync/workflow
  // callers, so the gate lives at this surface.
  const existing = await rc.ctx.runQuery(
    internal.documents.internal_queries.getDocumentByIdRaw,
    {
      documentId: toId<'documents'>(id),
      callerOrgId: rc.org.organizationId,
    },
  );
  if (!existing || existing.projectId != null) {
    return jsonError('Document not found', 404);
  }

  await rc.ctx.runMutation(
    internal.documents.internal_mutations.updateDocument,
    {
      documentId: toId<'documents'>(id),
      title: body.title,
      content: body.content,
      metadata: body.metadata,
      mimeType: body.mimeType,
      extension: body.extension,
      sourceProvider: body.sourceProvider,
      teamId: body.teamId,
      folderId: body.folderId,
      callerOrgId: rc.org.organizationId,
    },
  );

  return jsonNoContent();
});

export const deleteDocument = withRestAuth('rest:api', async (rc, request) => {
  const url = new URL(request.url);
  const { id } = extractPathParts(url, PREFIX);

  if (!id) {
    return jsonError('Missing document ID', 400);
  }

  // Project files are not deletable via the hub REST API (opaque 404; the
  // shared internal mutation stays open for retention/erasure callers).
  const existing = await rc.ctx.runQuery(
    internal.documents.internal_queries.getDocumentByIdRaw,
    {
      documentId: toId<'documents'>(id),
      callerOrgId: rc.org.organizationId,
    },
  );
  if (!existing || existing.projectId != null) {
    return jsonError('Document not found', 404);
  }

  await rc.ctx.runMutation(
    internal.documents.internal_mutations.deleteDocumentById,
    {
      documentId: toId<'documents'>(id),
      callerOrgId: rc.org.organizationId,
    },
  );

  return jsonNoContent();
});

export const documentSubActions = withRestAuth(
  'rest:api',
  async (rc, request) => {
    const url = new URL(request.url);
    const { id, subPath } = extractPathParts(url, PREFIX);

    if (!id) {
      return jsonError('Missing document ID', 400);
    }

    if (subPath === 'retry-indexing') {
      const documentId = toId<'documents'>(id);
      // Cross-tenant gate: every other REST handler in this file passes
      // `callerOrgId` so `getDocumentByIdRaw` can return null on cross-org
      // access. The retry-indexing path was missing this check; without
      // it, an OrgA REST key could re-index any OrgB document by id and
      // observe its existence + trigger writes in the other org's RAG.
      const doc = await rc.ctx.runQuery(
        internal.documents.internal_queries.getDocumentByIdRaw,
        { documentId, callerOrgId: rc.org.organizationId },
      );
      if (!doc) {
        return jsonError('Document not found', 404);
      }
      // Project files are not addressable via the hub REST API — same opaque
      // 404 as GET/PATCH/DELETE, so this sub-action can neither confirm a
      // project document exists nor push one into the org's knowledge corpus.
      if (doc.projectId != null) {
        return jsonError('Document not found', 404);
      }
      // A file whose metadata carries the persisted RAG opt-out never indexes
      // (uploadDocumentToRag refuses it) — answer honestly instead of claiming
      // 'indexing'. Clearing the opt-out stays a deliberate UI action.
      if (doc.fileId !== undefined) {
        const fileMetadata = await rc.ctx.runQuery(
          internal.file_metadata.internal_queries.getByStorageId,
          { storageId: doc.fileId },
        );
        if (fileMetadata?.skipRagIndexing === true) {
          return jsonOk({ status: 'skipped' });
        }
      }
      await rc.ctx.runAction(
        internal.documents.internal_actions.uploadDocumentToRag,
        {
          documentId,
          ...(doc.fileId !== undefined ? { expectedFileId: doc.fileId } : {}),
        },
      );
      return jsonOk({ status: 'indexing' });
    }

    return jsonError(`Unknown action: ${subPath}`, 404);
  },
);
