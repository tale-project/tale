#!/usr/bin/env bun
// =============================================================================
// Tale AI Gateway — Container test
// =============================================================================
// Builds, validates, and smoke-tests the subscription credential gateway
// (services/ai-gateway) using its standalone compose files
// (compose.ai-gateway.yml + compose.ai-gateway.test.yml). The four secrets the
// gateway refuses to boot without come from `.env.test`.
//
// Usage:
//   bun tests/container-ai-gateway-test.ts
// =============================================================================
import { runStaticSiteTest } from './static-site-test';

await runStaticSiteTest({
  name: 'ai-gateway',
  port: 13004,
  // The bundled server.js ships without node_modules (mirrors ui-docs) and the
  // panel is one screen, so the built image measures well under 100 MB.
  sizeBudgetMb: 250,
  probes: [
    // The panel shell is served to everyone; the sign-in happens inside it.
    {
      path: '/',
      status: 200,
      contentTypeIncludes: 'html',
      bodyIncludes: '<div id="root"',
    },
    // Both doors are closed to a caller with nothing: the token endpoint wants
    // the API key, the panel routes want a session.
    { path: '/api/tokens', status: 401, contentTypeIncludes: 'json' },
    { path: '/api/accounts', status: 401, contentTypeIncludes: 'json' },
    { path: '/api/providers', status: 401, contentTypeIncludes: 'json' },
  ],
});
