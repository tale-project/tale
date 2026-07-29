// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * A structural guard on the tenant chokepoint.
 *
 * The behavioural tests prove that `getKnowledgePoolForOrg` routes correctly.
 * They cannot prove that nobody bypassed it — a new module reading the corpus
 * through `getKnowledgePool()` would pass every one of them while reading the
 * SHARED database for an organization that has its own. The mistake is a single
 * plausible-looking line, its consequence is a cross-tenant read, and the only
 * thing that would otherwise catch it is a reviewer noticing. So it is a test.
 *
 * The same reasoning covers a second bypass: declaring a corpus table in
 * TypeScript instead of in the migrations. The schema was once spelled out in
 * three places and they drifted until a deploy failed on a column one of them
 * had never heard of.
 */

const DIRECTORY = path.dirname(fileURLToPath(import.meta.url));

/** The one module allowed to know about the deployment-default pool. */
const POOL_MODULE = 'pool.ts';

function sourceFiles(): string[] {
  return readdirSync(DIRECTORY)
    .filter((name) => name.endsWith('.ts') && !name.includes('.test.'))
    .sort();
}

function read(name: string): string {
  return readFileSync(path.join(DIRECTORY, name), 'utf8');
}

describe('nothing reaches the corpus except through the per-organization pool', () => {
  it('covers a non-trivial module set', () => {
    // A guard that silently stopped scanning would be worse than no guard.
    expect(sourceFiles().length).toBeGreaterThan(5);
  });

  it('has exactly one module that knows about the deployment-default pool', () => {
    const offenders = sourceFiles().filter(
      (name) =>
        name !== POOL_MODULE && /\bgetKnowledgePool\s*\(/.test(read(name)),
    );
    expect(offenders).toEqual([]);
  });

  it('opens no connection of its own', () => {
    // A module constructing its own client would sidestep the routing entirely.
    const offenders = sourceFiles().filter(
      (name) => name !== POOL_MODULE && /from 'postgres'/.test(read(name)),
    );
    for (const name of offenders) {
      // Importing the TYPE is fine; importing the driver itself is not.
      expect(read(name)).toMatch(/import type \{[^}]*\} from 'postgres'/);
    }
  });
});

describe('the corpus schema is declared in one place', () => {
  const CORPUS_TABLES = [
    'documents',
    'chunks',
    'semantic_cache',
    'websites',
    'website_urls',
    'website_org_memberships',
    'page_paragraph_hashes',
  ];

  it('declares no corpus table in TypeScript', () => {
    const offenders: string[] = [];
    for (const name of sourceFiles()) {
      const source = read(name);
      for (const table of CORPUS_TABLES) {
        // A `CREATE TABLE` for a corpus table anywhere here would be a second
        // declaration of a schema the migrations already own.
        const declares = new RegExp(
          `CREATE\\s+TABLE(\\s+IF\\s+NOT\\s+EXISTS)?[^;]*\\b${table}\\b`,
          'i',
        );
        if (declares.test(source)) offenders.push(`${name}: ${table}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
