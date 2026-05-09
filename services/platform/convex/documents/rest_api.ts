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

  return jsonOk(result);
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

  return jsonOk(document);
});

export const patchDocument = withRestAuth('rest:api', async (rc, request) => {
  const url = new URL(request.url);
  const { id } = extractPathParts(url, PREFIX);

  if (!id) {
    return jsonError('Missing document ID', 400);
  }

  const body = await request.json();

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
      await rc.ctx.runAction(
        internal.documents.internal_actions.uploadDocumentToRag,
        { documentId },
      );
      return jsonOk({ status: 'indexing' });
    }

    return jsonError(`Unknown action: ${subPath}`, 404);
  },
);
