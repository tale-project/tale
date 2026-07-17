#!/usr/bin/env bun
// =============================================================================
// Tale Docs — Container test
// =============================================================================
// Builds, validates, and smoke-tests the documentation site (services/docs)
// using its standalone compose files (compose.docs.yml + compose.docs.test.yml).
//
// Usage:
//   bun tests/container-docs-test.ts
// =============================================================================
import { runStaticSiteTest } from './static-site-test';

await runStaticSiteTest({
  name: 'docs',
  port: 13002,
  // The tutorial video series (public/videos/, 10 episodes × 3 locales) ships
  // inside the image — ~193 MB of mp4/vtt/webp on top of the site itself.
  sizeBudgetMb: 600,
  probes: [{ path: '/nope', status: 404 }],
});
