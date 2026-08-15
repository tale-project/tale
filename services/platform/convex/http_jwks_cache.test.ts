/**
 * The JWKS route's freshness contract. The deployment's own JWT validator
 * fetches this endpoint through an RFC-7234 HTTP cache that treats a
 * header-less 200 as instantly stale — so if this header disappears, every
 * JWT-carrying request (every `ctx.run*` callback of a `'use node'` action
 * included) goes back to executing this route live, and chat setup latency
 * multiplies by the syscall count. See the exact-path route in `http.ts`.
 */

import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import betterAuthSchema from './betterAuth/schema';
import schema from './schema';

const modules = import.meta.glob('./**/*.*s');
const authModules = import.meta.glob('./betterAuth/**/*.*s');

describe('jwks endpoint — shared-cache freshness', () => {
  it('serves the key set with a public max-age so the validator caches it', async () => {
    const t = convexTest(schema, modules);
    t.registerComponent('betterAuth', betterAuthSchema, authModules);

    const response = await t.fetch('/api/auth/convex/jwks', { method: 'GET' });

    expect(response.status).toBe(200);
    // `public` is load-bearing: the backend applies shared-cache semantics
    // and refuses to store `private`. A finite max-age bounds key-rotation
    // staleness; zero or absent re-inflicts one live fetch per validation.
    expect(response.headers.get('cache-control')).toMatch(
      /^public, max-age=[1-9]\d*$/,
    );
    const body = (await response.json()) as { keys?: unknown[] };
    expect(Array.isArray(body.keys)).toBe(true);
    expect(body.keys?.length).toBeGreaterThan(0);
  });
});
