import { isMigrationFile } from '@tale/shared/db/migration-files';

import { preconditionError } from '../../utils/fail';
import { git } from '../config/releases/git';
import {
  migrationInventorySchema,
  type MigrationInventory,
} from './migration-model';

export const SOURCE_MIGRATION_ROOTS = [
  'services/platform/backend/db/migrations/',
  'services/db/migrations/knowledge-db/private_knowledge/',
  'services/db/migrations/knowledge-db/public_web/',
] as const;

/** Read committed names, never the possibly dirty source working directory. */
export function sourceMigrationInventory(
  repoRoot: string,
  revision: string,
): MigrationInventory {
  const raw = git(
    repoRoot,
    'ls-tree',
    '-r',
    '-z',
    revision,
    '--',
    ...SOURCE_MIGRATION_ROOTS,
  );
  if (raw.length > 1_048_576)
    throw preconditionError(
      'Runtime migration source inventory exceeds its bound.',
    );
  const ids: string[][] = [[], [], []];
  for (const entry of raw.toString('utf8').split('\0').filter(Boolean)) {
    const match = /^100644 blob [a-f0-9]{40}\t([^\x00-\x1f]+)$/.exec(entry);
    if (!match)
      throw preconditionError(
        'Runtime migrations must be committed regular source files.',
      );
    const index = SOURCE_MIGRATION_ROOTS.findIndex((root) =>
      match[1].startsWith(root),
    );
    const name = match[1].slice(SOURCE_MIGRATION_ROOTS[index]?.length);
    if (index < 0 || name.includes('/'))
      throw preconditionError(
        'Runtime migration source has an unexpected directory.',
      );
    if (index === 0) {
      if (isMigrationFile(name)) ids[index].push(name);
    } else if (name.endsWith('.sql')) {
      const migration = /^([0-9]{14})_[a-z0-9_]+\.sql$/.exec(name);
      if (!migration)
        throw preconditionError(
          'Knowledge migration source has an unsupported filename.',
        );
      ids[index].push(BigInt(migration[1]).toString());
    } else if (isMigrationFile(name)) {
      throw preconditionError(
        'Knowledge migration source has an unsupported file type.',
      );
    }
  }
  return migrationInventorySchema.parse([
    {
      service: 'db',
      schema: 'public',
      table: 'app_migrations',
      ids: ids[0].sort(),
    },
    {
      service: 'knowledge-db',
      schema: 'private_knowledge',
      table: 'schema_migrations',
      ids: ids[1].sort(),
    },
    {
      service: 'knowledge-db',
      schema: 'public_web',
      table: 'schema_migrations',
      ids: ids[2].sort(),
    },
  ]);
}
