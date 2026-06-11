import { Command } from 'commander';

import { backup } from '../lib/actions/backup';
import { requireProject } from '../lib/project/find-project';
import { resolveProjectContext } from '../lib/project/project-context';
import { loadEnv } from '../utils/load-env';
import * as logger from '../utils/logger';

export function createBackupCommand(): Command {
  return new Command('backup')
    .description(
      'Snapshot all Tale data volumes into the project backups volume',
    )
    .action(async () => {
      try {
        const projectDir = requireProject();
        await resolveProjectContext(projectDir);
        const env = loadEnv(projectDir);
        await backup({ env });
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
