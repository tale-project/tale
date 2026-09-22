#!/usr/bin/env bun
// =============================================================================
// Tale AI Gateway — Container test
// =============================================================================
// Builds, validates, and smoke-tests the subscription credential gateway
// (services/ai-gateway) using its standalone compose files
// (compose.ai-gateway.yml + compose.ai-gateway.test.yml). The two secrets the
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
    // The panel is served to everyone: it has no login of its own, and a
    // deployment fronts the origin with whatever gate it wants.
    {
      path: '/',
      status: 200,
      contentTypeIncludes: 'html',
      bodyIncludes: '<div id="root"',
    },
    // The one door the app itself keeps: every token endpoint wants the API
    // key, and a caller with nothing gets none of them.
    { path: '/api/tokens', status: 401, contentTypeIncludes: 'json' },
    { path: '/api/tokens/anthropic', status: 401, contentTypeIncludes: 'json' },
    { path: '/api/tokens/openai', status: 401, contentTypeIncludes: 'json' },
    // The panel's own routes answer without one.
    { path: '/api/accounts', status: 200, contentTypeIncludes: 'json' },
    { path: '/api/providers', status: 200, contentTypeIncludes: 'json' },
  ],
});
