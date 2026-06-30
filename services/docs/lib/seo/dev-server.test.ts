/**
 * Regression test for the docs **dev** on-demand artifact server.
 *
 * Locks in the startup contract that keeps the docs e2e webServer reliable:
 * `createDocsArtifactsServer` must construct **synchronously** (no `docs/`
 * walk on the hot path), so `vite.config.ts` can instantiate it without a
 * top-level `await`. A regression to an `async` builder reintroduces the
 * top-level await that intermittently stalled CI's docs dev server past the
 * Playwright `webServer` timeout. The second test proves the deferral didn't
 * cost correctness: `robots.disallow` is still seeded from `noindex`
 * frontmatter, filled lazily by the first request.
 */

import { describe, expect, it } from 'vitest';

import { createDocsArtifactsServer } from './artifacts-server';

describe('docs dev artifact server', () => {
  it('constructs synchronously (no top-level await in vite.config)', () => {
    const server = createDocsArtifactsServer({ cache: false });
    // Not a Promise: returns a usable server object, not something awaitable.
    expect(server).not.toBeInstanceOf(Promise);
    expect(typeof server.handle).toBe('function');
    expect(typeof server.invalidate).toBe('function');
  });

  it('lazily fills robots.disallow from noindex frontmatter', async () => {
    const server = createDocsArtifactsServer({ cache: false });
    const response = await server.handle(
      new Request('https://tale.dev/robots.txt'),
    );
    expect(response).not.toBeNull();
    expect(response?.status).toBe(200);
    const text = (await response?.text()) ?? '';
    // The legal pages ship `noindex: true` in every locale; the disallow
    // list must reflect them even though the walk is deferred.
    expect(text).toContain('Disallow: /legal/privacy');
    expect(text).toContain('Disallow: /de/legal/privacy');
    expect(text).toContain('Disallow: /fr/legal/subprocessors');
  });
});
