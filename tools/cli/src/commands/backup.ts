import { Command } from 'commander';

import { backup } from '../lib/actions/backup';
import { requireProject } from '../lib/project/find-project';
import { resolveProjectContext } from '../lib/project/project-context';
import { loadEnv } from '../utils/load-env';
import { action } from '../utils/run-command';

export function createBackupCommand(): Command {
  return new Command('backup')
    .description(
      'Snapshot all Tale data volumes into the project backups volume',
    )
    .action(
      action(async () => {
        const projectDir = requireProject();
        await resolveProjectContext(projectDir);
        const env = loadEnv(projectDir);
        await backup({ env });
      }),
    );
}
