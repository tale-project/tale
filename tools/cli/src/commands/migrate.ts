import { Command } from 'commander';

import { migrateConfigLayout } from '../lib/actions/migrate-config-layout';
import { requireProject } from '../lib/project/find-project';
import { resolveProjectContext } from '../lib/project/project-context';
import * as logger from '../utils/logger';

export function createMigrateCommand(): Command {
  const migrateCmd = new Command('migrate').description(
    'One-shot, manually-run config migrations',
  );

  migrateCmd
    .command('config-layout')
    .description(
      'Relocate providers/*.secrets.json from the legacy per-domain layout ' +
        'to the org-first layout. Idempotent; copies (not moves) so old paths ' +
        'remain readable until --cleanup-old runs.',
    )
    .option('--dry-run', 'Preview moves without changing files', false)
    .option(
      '--cleanup-old',
      'After verifying new == old (byte-for-byte), remove the old-path ' +
        'secrets. Run only after the new deployment is healthy.',
      false,
    )
    .action(async (opts: { dryRun?: boolean; cleanupOld?: boolean }) => {
      try {
        const projectDir = requireProject();
        await resolveProjectContext(projectDir);
        await migrateConfigLayout({
          dryRun: opts.dryRun ?? false,
          cleanupOld: opts.cleanupOld ?? false,
          projectDir,
        });
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  return migrateCmd;
}
