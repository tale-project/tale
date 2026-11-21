// @vitest-environment node

import { existsSync, readdirSync } from 'node:fs';

import { isMigrationFile } from '@tale/shared/db/migration-files';
import { describe, expect, it } from 'vitest';

import {
  BUILT,
  builtMigrationName,
  MIGRATIONS_DIR,
  migrationFileOnDisk,
  PLATFORM_ROOT,
} from './layout';

/**
 * The backend reads its companions by location in two shapes: its sources,
 * and the flat build (`scripts/build-backend.ts`, whose own test boots the
 * build). These cases hold the source shape and the naming both shapes share.
 */
describe('where the backend finds its files, from the sources', () => {
  it('reads its shape off its own file: a source module is not built', () => {
    expect(BUILT).toBe(false);
  });

  it('roots the platform at services/platform, where the message catalogs are', () => {
    expect(existsSync(new URL('messages/en/', PLATFORM_ROOT))).toBe(true);
    expect(existsSync(new URL('backend/main.ts', PLATFORM_ROOT))).toBe(true);
  });

  it('finds the boot migrations under backend/db/migrations', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter(isMigrationFile);
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((file) => file.endsWith('.ts'))).toBe(true);
  });

  it('reads a migration from the file it is recorded under', () => {
    expect(migrationFileOnDisk('0001_init.sql')).toBe('0001_init.sql');
    expect(migrationFileOnDisk('0128_rag_codes.ts')).toBe('0128_rag_codes.ts');
  });
});

describe('the name a built migration is recorded under', () => {
  it('keeps a .sql file under its own name', () => {
    expect(builtMigrationName('0001_init.sql')).toBe('0001_init.sql');
  });

  it("records a compiled data migration under its source's name, so both shapes agree on what was applied", () => {
    expect(builtMigrationName('0128_rag_codes.js')).toBe('0128_rag_codes.ts');
  });

  it('is no migration for anything else in the directory', () => {
    expect(builtMigrationName('0128_rag_codes.js.map')).toBeNull();
    expect(builtMigrationName('README.md')).toBeNull();
  });
});
