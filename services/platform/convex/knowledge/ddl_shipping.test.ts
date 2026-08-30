// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { corpusMigrations, findMigrationsDir } from './ddl';

/**
 * The corpus DDL has to travel WITH the image.
 *
 * `findMigrationsDir` falls back to walking up the module path looking for a
 * repo checkout — which succeeds in a dev tree and finds nothing inside a
 * container. Preparing a new corpus (the deployment default on first boot,
 * and every BYO per-org database) applies these files at runtime, so a
 * production image that does not ship them degrades to "apply them
 * yourself". These are the guards for the two halves of the fix: the env
 * override is honoured, and the image actually copies the tree and names it.
 */

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
);
const dockerfile = path.join(repoRoot, 'services', 'platform', 'Dockerfile');
const migrationsTree = path.join(
  repoRoot,
  'services',
  'db',
  'migrations',
  'knowledge-db',
);

const savedDir = process.env.KNOWLEDGE_MIGRATIONS_DIR;
afterEach(() => {
  if (savedDir === undefined) delete process.env.KNOWLEDGE_MIGRATIONS_DIR;
  else process.env.KNOWLEDGE_MIGRATIONS_DIR = savedDir;
});

describe('corpus migrations ship with the image', () => {
  it('honours KNOWLEDGE_MIGRATIONS_DIR over the checkout walk', () => {
    process.env.KNOWLEDGE_MIGRATIONS_DIR = migrationsTree;
    expect(findMigrationsDir()).toBe(migrationsTree);
    // And the tree it points at is self-sufficient: every schema present,
    // every file readable SQL.
    const migrations = corpusMigrations();
    expect(migrations.length).toBeGreaterThan(0);
    for (const migration of migrations) {
      expect(migration.sql.trim().length).toBeGreaterThan(0);
    }
  });

  it('ships a schema directory per corpus schema', () => {
    const schemas = readdirSync(migrationsTree, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(schemas).toContain('private_knowledge');
    expect(schemas).toContain('public_web');
  });

  it('is copied into the platform image and named in its env', () => {
    expect(existsSync(dockerfile)).toBe(true);
    const contents = readFileSync(dockerfile, 'utf8');
    // The runner stage copies the tree and points the resolver at it; the
    // builder stage does the same so the dev image inherits it.
    expect(contents).toContain(
      'COPY --chown=app:app services/db/migrations/knowledge-db ./db/migrations/knowledge-db',
    );
    expect(contents).toContain(
      'KNOWLEDGE_MIGRATIONS_DIR=/app/db/migrations/knowledge-db',
    );
    expect(contents).toContain(
      'COPY services/db/migrations/knowledge-db ./services/db/migrations/knowledge-db',
    );
    expect(contents).toContain(
      'KNOWLEDGE_MIGRATIONS_DIR=/app/services/db/migrations/knowledge-db',
    );
  });
});
