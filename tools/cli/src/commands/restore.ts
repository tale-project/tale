import { Command } from 'commander';

import { restore } from '../lib/actions/restore';
import { requireProject } from '../lib/project/find-project';
import { resolveProjectContext } from '../lib/project/project-context';
import { loadEnv } from '../utils/load-env';
import { action } from '../utils/run-command';

export function createRestoreCommand(): Command {
  return new Command('restore')
    .description(
      'List volume snapshots, or restore one into the data volumes ' +
        '(the stack must be stopped)',
    )
    .argument('[snapshot-id]', 'snapshot to restore; omit to list snapshots')
    .option(
      '--stop',
      'before restoring, stop project containers that are running, restarting or paused',
    )
    .option('-y, --yes', 'non-interactive: skip the confirmation prompt')
    .option(
      '--resume',
      'Incus: finish the restore an interrupted run left pending',
    )
    .option(
      '--abort',
      'Incus: undo the restore an interrupted run left pending, putting every volume back',
    )
    .action(
      action(
        async (
          snapshotId: string | undefined,
          opts: {
            stop?: boolean;
            yes?: boolean;
            resume?: boolean;
            abort?: boolean;
          },
        ) => {
          const projectDir = requireProject();
          await resolveProjectContext(projectDir);
          const env = loadEnv(projectDir);
          await restore({
            env,
            snapshotId,
            stop: opts.stop,
            assumeYes: opts.yes,
            resume: opts.resume,
            abort: opts.abort,
          });
        },
      ),
    );
}
