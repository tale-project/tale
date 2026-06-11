import { Command } from 'commander';

import { restore } from '../lib/actions/restore';
import { requireProject } from '../lib/project/find-project';
import { resolveProjectContext } from '../lib/project/project-context';
import { loadEnv } from '../utils/load-env';
import * as logger from '../utils/logger';

export function createRestoreCommand(): Command {
  return new Command('restore')
    .description(
      'List volume snapshots, or restore one into the data volumes ' +
        '(the stack must be stopped)',
    )
    .argument('[snapshot-id]', 'snapshot to restore; omit to list snapshots')
    .option('--stop', 'stop running project containers before restoring')
    .option('-y, --yes', 'non-interactive: skip the confirmation prompt')
    .action(
      async (
        snapshotId: string | undefined,
        opts: { stop?: boolean; yes?: boolean },
      ) => {
        try {
          const projectDir = requireProject();
          await resolveProjectContext(projectDir);
          const env = loadEnv(projectDir);
          await restore({
            env,
            snapshotId,
            stop: opts.stop,
            assumeYes: opts.yes,
          });
        } catch (err) {
          logger.error(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      },
    );
}
