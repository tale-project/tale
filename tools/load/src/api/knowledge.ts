/**
 * Documents and knowledge retrieval as the SPA drives them.
 *
 * An upload is three requests (`app/lib/backend/documents.ts`):
 *
 *  1. `POST /api/app/files/blob-upload` presigns a PUT into the org's
 *     bucket (`{url, method: 'PUT', s3Ref}`), or refuses with 503
 *     `OBJECT_STORE_UNCONFIGURED` on a deployment without object storage;
 *  2. the browser PUTs the bytes straight to that URL, with exactly the
 *     content type the presign signed;
 *  3. `POST /api/app/documents/from-blob-upload` binds the landed object as
 *     a hub document, which queues it for indexing.
 *
 * Writing documents takes an editor seat (`RBAC_FORBIDDEN` 403 below it);
 * every member searches.
 */

import { errorCode } from '../client/index.ts';
import type { MetricsRegistry } from '../metrics/index.ts';
import {
  type ApiClient,
  type ApiResult,
  asRecord,
  asString,
  mapResult,
  orgQuery,
  rowsOf,
} from './client.ts';

/** The object store refused for want of configuration. */
export const OBJECT_STORE_UNCONFIGURED = 'OBJECT_STORE_UNCONFIGURED';

export interface UploadTicket {
  url: string;
  storageRef: string;
}

/** `POST /api/app/files/blob-upload?orgId=` (rate limited: 50/min/user). */
export async function presignUpload(
  api: ApiClient,
  orgId: string,
  contentType: string,
): Promise<ApiResult<UploadTicket>> {
  const result = await api.call<unknown>({
    method: 'POST',
    path: '/api/app/files/blob-upload',
    query: orgQuery(orgId),
    json: { contentType },
    name: 'POST /api/app/files/blob-upload',
    refusals: [503],
  });
  return mapResult(result, (body) => {
    const record = asRecord(body);
    const url = asString(record?.url);
    const storageRef = asString(record?.s3Ref);
    return url === undefined || storageRef === undefined
      ? undefined
      : { url, storageRef };
  });
}

/** Anything with undici's `request` (an `Agent`, a `Pool`). */
export interface RawDispatcher {
  request(options: {
    origin: string;
    path: string;
    method: 'PUT';
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  }): Promise<{
    statusCode: number;
    body: { text(): Promise<string> };
  }>;
}

export const PRESIGNED_PUT_NAME = 'PUT <object store presigned URL>';

/**
 * PUT the bytes to a presigned URL — another origin (the object store), so
 * outside the user's HTTP client; recorded under {@link PRESIGNED_PUT_NAME}.
 * Never throws; answers the status (`0` for a network failure).
 */
export async function putPresigned(
  dispatcher: RawDispatcher,
  metrics: MetricsRegistry,
  url: string,
  contentType: string,
  body: string,
  timeoutMs: number,
): Promise<number> {
  const target = new URL(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await dispatcher.request({
      origin: target.origin,
      path: `${target.pathname}${target.search}`,
      method: 'PUT',
      headers: { 'content-type': contentType },
      body,
      signal: controller.signal,
    });
    const text = await response.body.text();
    const status = response.statusCode;
    metrics.request(PRESIGNED_PUT_NAME, performance.now() - started, status);
    if (status < 200 || status >= 300) {
      metrics.error(
        PRESIGNED_PUT_NAME,
        `http_${status}`,
        `PUT ${target.host}${target.pathname} -> ${status}: ${text}`,
      );
    }
    return status;
  } catch (error) {
    metrics.request(PRESIGNED_PUT_NAME, performance.now() - started, 0);
    metrics.error(
      PRESIGNED_PUT_NAME,
      `net_${errorCode(error)}`,
      `PUT ${target.host}${target.pathname}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

/** `POST /api/app/documents/from-blob-upload?orgId=` → the document id. */
export async function createDocumentFromUpload(
  api: ApiClient,
  orgId: string,
  args: {
    storageRef: string;
    fileName: string;
    contentType: string;
    projectId?: string;
  },
): Promise<ApiResult<string>> {
  const result = await api.call<unknown>({
    method: 'POST',
    path: '/api/app/documents/from-blob-upload',
    query: orgQuery(orgId),
    json: args,
    name: 'POST /api/app/documents/from-blob-upload',
    refusals: [403, 409, 413],
  });
  return mapResult(result, (body) => asString(asRecord(body)?.documentId));
}

/** `GET /api/app/documents/paginated?numItems=&orgId=` — the hub's root. */
export async function listHubDocuments(
  api: ApiClient,
  orgId: string,
  numItems = 25,
): Promise<ApiResult<string[]>> {
  const result = await api.call<unknown>({
    method: 'GET',
    path: '/api/app/documents/paginated',
    query: orgQuery(orgId, { numItems }),
    name: 'GET /api/app/documents/paginated',
  });
  return mapResult(result, (body) =>
    rowsOf(body, 'page').flatMap((row) => {
      const id = asString(row.id) ?? asString(row._id);
      return id === undefined ? [] : [id];
    }),
  );
}

/** `GET /api/app/documents/search-hub?q=&orgId=` — the hub's name search. */
export function searchHub(
  api: ApiClient,
  orgId: string,
  query: string,
): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'GET',
    path: '/api/app/documents/search-hub',
    query: orgQuery(orgId, { q: query }),
    name: 'GET /api/app/documents/search-hub',
  });
}

/** Knowledge-search codes meaning "this org cannot search": stop trying. */
export const KNOWLEDGE_UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  'EMBEDDING_NOT_CONFIGURED',
  'EMBEDDING_CREDENTIAL_REJECTED',
  'EMBEDDING_CREDIT_EXHAUSTED',
  'KNOWLEDGE_NOT_CONFIGURED',
]);

/** `POST /api/app/knowledge/search?orgId=` → the number of hits. */
export async function searchKnowledge(
  api: ApiClient,
  orgId: string,
  query: string,
  limit = 10,
): Promise<ApiResult<number>> {
  const result = await api.call<unknown>({
    method: 'POST',
    path: '/api/app/knowledge/search',
    query: orgQuery(orgId),
    json: { query, corpus: 'documents', limit },
    name: 'POST /api/app/knowledge/search',
    refusals: [409, 503],
  });
  return mapResult(result, (body) => rowsOf(body, 'hits').length);
}
