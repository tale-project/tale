import { Command } from 'commander';

import { migrateConfigLayout } from '../lib/actions/migrate-config-layout';
import { requireProject } from '../lib/project/find-project';
import { resolveProjectContext } from '../lib/project/project-context';
import * as logger from '../utils/logger';

/**
 * `tale migrate` is deprecated as a user-facing surface — `tale start`,
 * `tale deploy`, and `tale update` now auto-detect the legacy flat
 * layout and prompt the operator inline (see
 * `lib/actions/legacy-layout-preflight.ts`).
 *
 * What's preserved:
 *   - `tale migrate config-layout --cleanup-old` stays available
 *     (hidden from `--help`) as the optional post-migration
 *     housekeeping step that byte-for-byte verifies the new paths
 *     and removes the rollback-insurance copies under the old
 *     per-domain dirs in the convex container's $DATA volume. The
 *     forward migration runs automatically, but the cleanup is a
 *     deliberate operator-pull action.
 *   - `tale migrate config-layout` (no-flag) prints a deprecation
 *     notice pointing at `tale start --yes` and exits non-zero, so
 *     scripts and CI pipelines that still call it surface clearly
 *     during the deprecation window.
 */
export function createMigrateCommand(): Command {
  const migrateCmd = new Command('migrate')
    .description(
      '[deprecated] Forward migration runs automatically on tale start / deploy / update. ' +
        '`config-layout --cleanup-old` remains for post-migration housekeeping.',
    )
    .helpOption(false);

  migrateCmd
    .command('config-layout')
    .description(
      'Forward migration: deprecated (`tale start --yes` now runs it). ' +
        '--cleanup-old: byte-for-byte verify new paths, then remove rollback-insurance copies.',
    )
    .option('--dry-run', 'Preview moves without changing files', false)
    .option(
      '--cleanup-old',
      'After verifying new == old (byte-for-byte), remove the old-path secrets. ' +
        'Run only after the new deployment is healthy.',
      false,
    )
    .action(async (opts: { dryRun?: boolean; cleanupOld?: boolean }) => {
      try {
        if (!opts.cleanupOld) {
          logger.error(
            '`tale migrate config-layout` (without --cleanup-old) is deprecated. ' +
              'The forward migration now runs automatically when `tale start`, ' +
              '`tale deploy --override-all`, or `tale update` detects a legacy ' +
              'layout. Re-run one of those commands; add `--yes` for non-interactive ' +
              'environments.',
          );
          process.exit(2);
        }
        const projectDir = requireProject();
        await resolveProjectContext(projectDir);
        await migrateConfigLayout({
          dryRun: opts.dryRun ?? false,
          cleanupOld: true,
          projectDir,
        });
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  return migrateCmd;
}
