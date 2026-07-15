import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  ensureKnowledgeSchema,
  KNOWLEDGE_BOOTSTRAP_DDL,
} from './ensure_knowledge_schema';

/** A fake postgres.js `Sql` that records the DDL run through `.unsafe().simple()`. */
function makeCapturingSql(): { sql: Sql; captured: string[] } {
  const captured: string[] = [];
  const sql = {
    unsafe: (ddl: string) => ({
      simple: () => {
        captured.push(ddl);
        return Promise.resolve([]);
      },
    }),
  } as unknown as Sql;
  return { sql, captured };
}

describe('ensureKnowledgeSchema', () => {
  it('runs the bootstrap DDL once via the simple protocol', async () => {
    const { sql, captured } = makeCapturingSql();
    await ensureKnowledgeSchema(sql);
    expect(captured).toHaveLength(1);
    expect(captured[0]).toBe(KNOWLEDGE_BOOTSTRAP_DDL);
  });

  it('creates the required extension, both schemas, tables, and index functions', () => {
    // vector is REQUIRED; pg_search is best-effort (wrapped so a plain-pgvector
    // BYO DB still bootstraps and serves vector-only search).
    expect(KNOWLEDGE_BOOTSTRAP_DDL).toContain(
      'CREATE EXTENSION IF NOT EXISTS vector;',
    );
    expect(KNOWLEDGE_BOOTSTRAP_DDL).toContain(
      'CREATE EXTENSION IF NOT EXISTS pg_search;',
    );
    expect(KNOWLEDGE_BOOTSTRAP_DDL).toMatch(
      /CREATE EXTENSION IF NOT EXISTS pg_search;[\s\S]*EXCEPTION WHEN OTHERS/,
    );
    expect(KNOWLEDGE_BOOTSTRAP_DDL).toContain(
      'CREATE SCHEMA IF NOT EXISTS private_knowledge;',
    );
    for (const table of ['documents', 'chunks', 'semantic_cache']) {
      expect(KNOWLEDGE_BOOTSTRAP_DDL).toContain(
        `CREATE TABLE IF NOT EXISTS private_knowledge.${table}`,
      );
    }
    expect(KNOWLEDGE_BOOTSTRAP_DDL).toContain(
      'FUNCTION private_knowledge.create_chunks_hnsw_index()',
    );

    // public_web (crawler) is bootstrapped per-org alongside private_knowledge —
    // nothing in the knowledge DBs is shared across orgs.
    expect(KNOWLEDGE_BOOTSTRAP_DDL).toContain(
      'CREATE SCHEMA IF NOT EXISTS public_web;',
    );
    for (const table of [
      'websites',
      'website_org_memberships',
      'website_urls',
      'page_paragraph_hashes',
      'chunks',
    ]) {
      expect(KNOWLEDGE_BOOTSTRAP_DDL).toContain(
        `CREATE TABLE IF NOT EXISTS public_web.${table}`,
      );
    }
    expect(KNOWLEDGE_BOOTSTRAP_DDL).toContain(
      'FUNCTION public_web.create_chunks_hnsw_index()',
    );
  });

  it('is idempotent-safe: no destructive statements', () => {
    expect(KNOWLEDGE_BOOTSTRAP_DDL).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(KNOWLEDGE_BOOTSTRAP_DDL).not.toMatch(/\bDROP\s+SCHEMA\b/i);
    expect(KNOWLEDGE_BOOTSTRAP_DDL).not.toMatch(/\bTRUNCATE\b/i);
    expect(KNOWLEDGE_BOOTSTRAP_DDL).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it('stays aligned with the private_knowledge baseline migration (drift guard)', () => {
    const baselinePath = fileURLToPath(
      new URL(
        '../../../../../db/migrations/knowledge-db/private_knowledge/00000000000001_knowledge_private_baseline.sql',
        import.meta.url,
      ),
    );
    const baseline = readFileSync(baselinePath, 'utf8');
    // Every object the baseline defines must appear in the embedded DDL, so a
    // baseline change that isn't mirrored here fails loudly.
    const anchors = [
      'CREATE SCHEMA IF NOT EXISTS private_knowledge;',
      'CREATE TABLE IF NOT EXISTS private_knowledge.documents',
      'CREATE TABLE IF NOT EXISTS private_knowledge.chunks',
      'CREATE TABLE IF NOT EXISTS private_knowledge.semantic_cache',
      'documents_id_org_unique',
      'chunks_document_id_org_fkey',
      'idx_pk_chunks_bm25',
      'idx_pk_semcache_org_expires',
      'FUNCTION private_knowledge.create_chunks_hnsw_index()',
    ];
    for (const anchor of anchors) {
      expect(baseline, `baseline missing anchor: ${anchor}`).toContain(anchor);
      expect(
        KNOWLEDGE_BOOTSTRAP_DDL,
        `embedded DDL missing baseline anchor: ${anchor}`,
      ).toContain(anchor);
    }
  });

  it('stays aligned with the public_web baseline migration (drift guard)', () => {
    const baselinePath = fileURLToPath(
      new URL(
        '../../../../../db/migrations/knowledge-db/public_web/00000000000002_knowledge_web_baseline.sql',
        import.meta.url,
      ),
    );
    const baseline = readFileSync(baselinePath, 'utf8');
    // Every object the crawler baseline defines must appear in the embedded DDL,
    // so a baseline change that isn't mirrored here fails loudly.
    const anchors = [
      'CREATE SCHEMA IF NOT EXISTS public_web;',
      'CREATE TABLE IF NOT EXISTS public_web.websites',
      'CREATE TABLE IF NOT EXISTS public_web.website_org_memberships',
      'CREATE TABLE IF NOT EXISTS public_web.website_urls',
      'CREATE TABLE IF NOT EXISTS public_web.page_paragraph_hashes',
      'CREATE TABLE IF NOT EXISTS public_web.chunks',
      'websites_status_check',
      'idx_website_org_memberships_by_org',
      'idx_pw_chunks_bm25',
      'FUNCTION public_web.create_chunks_hnsw_index()',
    ];
    for (const anchor of anchors) {
      expect(baseline, `baseline missing anchor: ${anchor}`).toContain(anchor);
      expect(
        KNOWLEDGE_BOOTSTRAP_DDL,
        `embedded DDL missing baseline anchor: ${anchor}`,
      ).toContain(anchor);
    }
  });
});
