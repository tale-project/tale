import { describe, expect, it } from 'vitest';

import { extractPathParts, jsonError } from './helpers';

/**
 * `jsonError` is the MCP door's refusal shape; it carries the CORS headers a
 * browser-hosted MCP client needs to read the refusal at all — the preflight
 * must be allowed to send the bearer and the org header.
 */
describe('jsonError', () => {
  it('answers the JSON envelope with CORS headers a browser client can read', async () => {
    const res = jsonError('nope', 403);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'nope' });
    const allowHeaders = res.headers.get('Access-Control-Allow-Headers');
    expect(allowHeaders).toContain('Authorization');
    expect(allowHeaders).toContain('X-Organization-Slug');
  });
});

/**
 * `extractPathParts` must LOCATE the prefix, not assume it at position 0: the
 * SCIM door is mounted on `/scim/v2` AND the 0.4 proxy-era alias
 * `/http_api/scim/v2` (the tenant URL the admin UI advertises to IdPs), and
 * the dispatchers parse the raw request URL. `/http_api/scim/` is exactly as
 * long as `/scim/v2/Users/`, so the old blind slice turned every alias-mount
 * per-resource op into `id: 'v2'` — IdP update/deactivate/delete all 404ed.
 */
describe('extractPathParts', () => {
  it('parses the id on the bare mount', () => {
    const url = new URL('https://tale.example/scim/v2/Users/u_123');
    expect(extractPathParts(url, '/scim/v2/Users/')).toEqual({
      id: 'u_123',
      subPath: null,
    });
  });

  it('parses the id on the /http_api alias mount', () => {
    const url = new URL('https://tale.example/http_api/scim/v2/Users/u_123');
    expect(extractPathParts(url, '/scim/v2/Users/')).toEqual({
      id: 'u_123',
      subPath: null,
    });
  });

  it('parses group ids on both mounts', () => {
    const bare = new URL('https://tale.example/scim/v2/Groups/team_9');
    const alias = new URL(
      'https://tale.example/http_api/scim/v2/Groups/team_9',
    );
    expect(extractPathParts(bare, '/scim/v2/Groups/').id).toBe('team_9');
    expect(extractPathParts(alias, '/scim/v2/Groups/').id).toBe('team_9');
  });

  it('answers an empty id when the pathname lacks the prefix entirely', () => {
    const url = new URL('https://tale.example/scim/v2/Users');
    expect(extractPathParts(url, '/scim/v2/Users/')).toEqual({
      id: '',
      subPath: null,
    });
  });

  it('keeps sub-path extraction working after the prefix', () => {
    const url = new URL(
      'https://tale.example/api/v1/documents/abc123/retry-indexing',
    );
    expect(extractPathParts(url, '/api/v1/documents/')).toEqual({
      id: 'abc123',
      subPath: 'retry-indexing',
    });
  });
});
