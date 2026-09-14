#!/usr/bin/env bun
// =============================================================================
// Tale UI Docs — Container test
// =============================================================================
// Builds, validates, and smoke-tests the design-system documentation site
// (services/ui-docs) using its standalone compose files (compose.ui-docs.yml +
// compose.ui-docs.test.yml).
//
// Usage:
//   bun tests/container-ui-docs-test.ts
// =============================================================================
import { runStaticSiteTest } from './static-site-test';

await runStaticSiteTest({
  name: 'ui-docs',
  port: 13003,
  // The bundled server.js ships without node_modules (mirrors docs/web) and
  // the site carries no video/heavy media, so the built image measures
  // ~85 MB; budget gives headroom for the doc/demo corpus to grow.
  sizeBudgetMb: 250,
  probes: [
    { path: '/docs/does-not-exist', status: 404, contentTypeIncludes: 'html' },
    { path: '/llms.txt', status: 200 },
    { path: '/sitemap.xml', status: 200, contentTypeIncludes: 'xml' },
    { path: '/robots.txt', status: 200 },
    { path: '/docs/components/button', status: 200, bodyIncludes: '<h1' },
    {
      path: '/docs/components/button.md',
      status: 200,
      contentTypeIncludes: 'text/markdown',
    },
  ],
});
