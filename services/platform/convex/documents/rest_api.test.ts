/**
 * The documents REST sub-action surface.
 *
 * What is pinned here: `POST /api/v1/documents/:id/retry-indexing` treats a
 * project-scoped document exactly like GET/PATCH/DELETE do — an opaque 404 —
 * so a hub REST key can neither confirm a project document exists nor push
 * project working files into the organization's knowledge corpus.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_generated/server', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  httpAction: (handler: unknown) => handler,
}));

vi.mock('../lib/rate_limiter/helpers', () => ({
  checkIpRateLimit: vi.fn(),
  checkOrganizationRateLimit: vi.fn(),
  RateLimitExceededError: class RateLimitExceededError extends Error {},
}));

const getSession = vi.fn();
vi.mock('../auth', () => ({
  createAuth: () => ({ api: { getSession } }),
}));

import {
  argsOf,
  called,
  jsonBody,
  restCtx,
  restRequest,
  testSession,
  TEST_ORG_ID,
} from '../lib/rest/handler_kit.testkit';
import type { HttpCtx } from '../lib/rest/helpers';
import { documentSubActions } from './rest_api';

type Handler = (ctx: HttpCtx, request: Request) => Promise<Response>;

const GET_RAW = 'documents/internal_queries:getDocumentByIdRaw';
const GET_FILE_META = 'file_metadata/internal_queries:getByStorageId';
const UPLOAD_TO_RAG = 'documents/internal_actions:uploadDocumentToRag';

function hubDoc() {
  return {
    _id: 'doc_hub',
    organizationId: TEST_ORG_ID,
    title: 'Handbook.pdf',
    fileId: 'blob_hub',
  };
}

function projectDoc() {
  return { ...hubDoc(), _id: 'doc_project', projectId: 'project_1' };
}

function retryRequest(id: string): Request {
  return restRequest(`/api/v1/documents/${id}/retry-indexing`, {
    method: 'POST',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(testSession());
});

describe('POST /api/v1/documents/:id/retry-indexing', () => {
  it('re-indexes a hub document, passing its current file as the expected generation', async () => {
    const { ctx, calls } = restCtx({
      [GET_RAW]: () => hubDoc(),
      [GET_FILE_META]: () => ({ storageId: 'blob_hub' }),
      [UPLOAD_TO_RAG]: () => null,
    });

    const response = await (documentSubActions as unknown as Handler)(
      ctx,
      retryRequest('doc_hub'),
    );

    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toEqual({ status: 'indexing' });
    expect(argsOf(calls, GET_RAW)).toEqual({
      documentId: 'doc_hub',
      callerOrgId: TEST_ORG_ID,
    });
    expect(argsOf(calls, UPLOAD_TO_RAG)).toEqual({
      documentId: 'doc_hub',
      expectedFileId: 'blob_hub',
    });
  });

  it('answers "skipped" for a hub file with the persisted RAG opt-out and never touches RAG', async () => {
    const { ctx, calls } = restCtx({
      [GET_RAW]: () => hubDoc(),
      [GET_FILE_META]: () => ({ storageId: 'blob_hub', skipRagIndexing: true }),
      [UPLOAD_TO_RAG]: () => null,
    });

    const response = await (documentSubActions as unknown as Handler)(
      ctx,
      retryRequest('doc_hub'),
    );

    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toEqual({ status: 'skipped' });
    expect(called(calls, UPLOAD_TO_RAG)).toBe(false);
  });

  it('answers an opaque 404 for a project document and never touches RAG', async () => {
    const { ctx, calls } = restCtx({
      [GET_RAW]: () => projectDoc(),
      [UPLOAD_TO_RAG]: () => null,
    });

    const response = await (documentSubActions as unknown as Handler)(
      ctx,
      retryRequest('doc_project'),
    );

    // Same body as a document that does not exist at all — the sub-action
    // must not confirm a project document's existence.
    expect(response.status).toBe(404);
    expect(await jsonBody(response)).toEqual({ error: 'Document not found' });
    expect(called(calls, UPLOAD_TO_RAG)).toBe(false);
  });

  it('answers the same 404 for a document this organization does not have', async () => {
    const { ctx, calls } = restCtx({
      [GET_RAW]: () => null,
      [UPLOAD_TO_RAG]: () => null,
    });

    const response = await (documentSubActions as unknown as Handler)(
      ctx,
      retryRequest('doc_foreign'),
    );

    expect(response.status).toBe(404);
    expect(await jsonBody(response)).toEqual({ error: 'Document not found' });
    expect(called(calls, UPLOAD_TO_RAG)).toBe(false);
  });

  it('rejects an unknown sub-action with 404', async () => {
    const { ctx, calls } = restCtx({ [GET_RAW]: () => hubDoc() });

    const response = await (documentSubActions as unknown as Handler)(
      ctx,
      restRequest('/api/v1/documents/doc_hub/expunge', { method: 'POST' }),
    );

    expect(response.status).toBe(404);
    expect(called(calls, GET_RAW)).toBe(false);
  });
});
