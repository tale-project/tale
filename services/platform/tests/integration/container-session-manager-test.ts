#!/usr/bin/env bun
// =============================================================================
// Tale Session Manager — Container test
// =============================================================================
// Builds, validates, and smoke-tests the session manager (services/session-manager)
// using its standalone compose files (compose.session-manager.yml +
// compose.session-manager.test.yml).
//
// The test container never installs the Camoufox browser (the test compose file
// keeps its background download off the network), so these probes read only
// what the server answers without one: the page, the API and the MCP endpoint.
//
// Usage:
//   bun tests/container-session-manager-test.ts
// =============================================================================
import { runStaticSiteTest } from './static-site-test';

await runStaticSiteTest({
  name: 'session-manager',
  port: 13004,
  // Bun, the GTK and X11 libraries a headless Firefox links against, and the
  // server's runtime dependencies: 369 MB unpacked (117 MB packed, which is
  // what a containerd image store reports); the budget gives headroom for
  // them to grow. The 1.3 GB Camoufox browser is downloaded into the data
  // volume at the first start and is not part of the image.
  sizeBudgetMb: 600,
  probes: [
    {
      path: '/',
      status: 200,
      contentTypeIncludes: 'text/html',
      requireHeaders: ['content-security-policy'],
    },
    // A route of the single-page app is answered with the page.
    { path: '/sessions', status: 200, contentTypeIncludes: 'text/html' },
    // The server reports the version its image was built as.
    {
      path: '/api/meta',
      status: 200,
      contentTypeIncludes: 'json',
      bodyIncludes: '"version":"{imageVersion}"',
    },
    // An unknown API path is the API's own JSON 404, not the page.
    {
      path: '/api/nope',
      status: 404,
      contentTypeIncludes: 'json',
      bodyIncludes: 'not_found',
    },
    // The MCP endpoint is mounted, and AI access is off in a new manager.
    {
      path: '/mcp',
      status: 403,
      contentTypeIncludes: 'json',
      bodyIncludes: 'ai_access_off',
    },
  ],
});
