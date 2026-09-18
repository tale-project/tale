import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import type { Auth } from '../../auth/auth.ts';
import { createSsoAdminRoutes } from './admin-routes.ts';

/**
 * `GET /api/app/sso/discovery/trusted-headers` — the login page's question
 * "did this request come through an authenticating proxy?". Presence only:
 * the door validates the key; this route touches neither the database nor
 * a session, so the router is built on inert dependencies.
 */

const app = createSsoAdminRoutes({
  sql: {} as unknown as Sql,
  auth: {} as unknown as Auth,
});

async function probe(headers: Record<string, string> = {}) {
  const res = await app.request('/discovery/trusted-headers', { headers });
  return {
    status: res.status,
    body: (await res.json()) as { handoff: boolean },
    cache: res.headers.get('cache-control'),
  };
}

describe('GET /discovery/trusted-headers — is a proxy hand-off on this request', () => {
  it('answers no for a plain browser request, and never caches', async () => {
    const answer = await probe();
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ handoff: false });
    expect(answer.cache).toBe('no-store');
  });

  it('answers yes when the key rides in the key header', async () => {
    expect(
      (await probe({ 'remote-internal-secret': 'thk_0123456789abcdef' })).body,
    ).toEqual({ handoff: true });
  });

  it('ignores an Authorization header — the key has one slot, and the REST API key is not it', async () => {
    expect(
      (await probe({ authorization: 'Bearer thk_0123456789abcdef' })).body,
    ).toEqual({ handoff: false });
  });

  it("answers yes on the proxy's identity header alone — the key may ride on the door only", async () => {
    expect(
      (await probe({ 'remote-email': 'member@example.com' })).body,
    ).toEqual({ handoff: true });
  });

  it('reads an empty identity header as absent', async () => {
    expect((await probe({ 'remote-email': '   ' })).body).toEqual({
      handoff: false,
    });
  });
});
