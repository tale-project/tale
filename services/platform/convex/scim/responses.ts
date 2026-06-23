/**
 * SCIM response builders. Every SCIM body uses `application/scim+json` and the
 * RFC 7644 envelopes (ListResponse / Error).
 */

import {
  SCIM_ERROR_SCHEMA,
  SCIM_LIST_RESPONSE_SCHEMA,
  type ScimResource,
} from './types';

const SCIM_CONTENT_TYPE = 'application/scim+json';

export const SCIM_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

export function scimJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': SCIM_CONTENT_TYPE, ...SCIM_CORS_HEADERS },
  });
}

export function scimNoContent(): Response {
  return new Response(null, { status: 204, headers: SCIM_CORS_HEADERS });
}

/**
 * RFC 7644 §3.12 error envelope. `scimType` is the spec's machine-readable
 * code (e.g. `uniqueness`, `invalidFilter`) and is omitted when not applicable.
 */
export function scimError(
  status: number,
  detail: string,
  scimType?: string,
): Response {
  return scimJson(
    {
      schemas: [SCIM_ERROR_SCHEMA],
      ...(scimType ? { scimType } : {}),
      detail,
      status: String(status),
    },
    status,
  );
}

export function scimListResponse(
  resources: ScimResource[],
  totalResults: number,
  startIndex: number,
  itemsPerPage: number,
): Response {
  return scimJson({
    schemas: [SCIM_LIST_RESPONSE_SCHEMA],
    totalResults,
    startIndex,
    itemsPerPage,
    Resources: resources,
  });
}
