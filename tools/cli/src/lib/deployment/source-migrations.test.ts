import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { migrationInventorySchema } from './migration-model';
import { runtimeFixture, type RuntimeFixture } from './runtime-test-helper';
import { sourceMigrationInventory } from './source-migrations';

const fixtures: RuntimeFixture[] = [];
afterEach(() => {
  for (const owned of fixtures.splice(0))
    rmSync(owned.directory, { recursive: true, force: true });
});
function fixture() {
  const value = runtimeFixture();
  fixtures.push(value);
  return value;
}
const app = 'services/platform/backend/db/migrations/';
const knowledge = 'services/db/migrations/knowledge-db/public_web/';

describe.skipIf(process.platform === 'win32')(
  'source-bound migration acceptance inventory',
  () => {
    test('includes SQL and numbered TS data migrations from committed bytes, ignoring dirty working files', () => {
      const f = fixture();
      writeFileSync(join(f.repoRoot, app, '0003_not_committed.sql'), '');
      const actual = sourceMigrationInventory(f.repoRoot, f.revision);
      expect(actual).toEqual([
        {
          service: 'db',
          schema: 'public',
          table: 'app_migrations',
          ids: ['0001_initial.sql', '0002_data.ts'],
        },
        {
          service: 'knowledge-db',
          schema: 'private_knowledge',
          table: 'schema_migrations',
          ids: ['1'],
        },
        {
          service: 'knowledge-db',
          schema: 'public_web',
          table: 'schema_migrations',
          ids: ['2'],
        },
      ]);
    });
    test.each([
      app + 'unnumbered.sql',
      app + 'nested/0003_hidden.sql',
      knowledge + '00000000000002_duplicate.sql',
      knowledge + '00000000000000_zero.sql',
      knowledge + '00000000000003_data.ts',
      knowledge + 'short.sql',
    ])('refuses unsupported or ambiguous source %s', (file) => {
      const f = fixture();
      mkdirSync(join(f.repoRoot, file, '..'), { recursive: true });
      writeFileSync(join(f.repoRoot, file), '');
      f.git('add', '.');
      f.git('commit', '-qm', 'unsupported migration');
      expect(() =>
        sourceMigrationInventory(f.repoRoot, f.git('rev-parse', 'HEAD')),
      ).toThrow();
    });
    test('refuses symlinked migration source', () => {
      const f = fixture();
      symlinkSync('0001_initial.sql', join(f.repoRoot, app, '0003_link.sql'));
      f.git('add', '.');
      f.git('commit', '-qm', 'linked migration');
      expect(() =>
        sourceMigrationInventory(f.repoRoot, f.git('rev-parse', 'HEAD')),
      ).toThrow(/regular/);
    });
    test('keeps non-migration test/declaration companions out of the inventory', () => {
      const f = fixture();
      for (const name of ['0002_data.test.ts', 'types.d.ts', 'README.md'])
        writeFileSync(join(f.repoRoot, app, name), '');
      f.git('add', '.');
      f.git('commit', '-qm', 'migration companions');
      expect(
        sourceMigrationInventory(f.repoRoot, f.git('rev-parse', 'HEAD')),
      ).toEqual(sourceMigrationInventory(f.repoRoot, f.revision));
    });
    test('requires all three ledgers, bounded sorted identities and strict fields', () => {
      const f = fixture();
      const value = sourceMigrationInventory(f.repoRoot, f.revision);
      expect(
        migrationInventorySchema.safeParse(value.slice(0, 2)).success,
      ).toBe(false);
      for (const ids of [
        [],
        ['1', '1'],
        ['2', '1'],
        ['01'],
        Array(2049).fill('1'),
      ])
        expect(
          migrationInventorySchema.safeParse([
            value[0],
            { ...value[1], ids },
            value[2],
          ]).success,
        ).toBe(false);
      expect(
        migrationInventorySchema.safeParse([
          { ...value[0], accepted: true },
          value[1],
          value[2],
        ]).success,
      ).toBe(false);
    });
  },
);
