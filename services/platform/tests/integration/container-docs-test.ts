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

await runStaticSiteTest({ name: 'docs', port: 13002, sizeBudgetMb: 400 });
