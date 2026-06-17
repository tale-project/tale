#!/usr/bin/env bun
// =============================================================================
// Tale Web — Container test
// =============================================================================
// Builds, validates, and smoke-tests the marketing site (services/web)
// using its standalone compose files (compose.web.yml + compose.web.test.yml).
//
// Usage:
//   bun tests/container-web-test.ts
// =============================================================================
import { runStaticSiteTest } from './static-site-test';

await runStaticSiteTest({ name: 'web', port: 13001, sizeBudgetMb: 400 });
