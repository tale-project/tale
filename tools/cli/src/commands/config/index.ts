import { Command } from 'commander';

import { findProject } from '../../lib/project/find-project';
import * as logger from '../../utils/logger';

export function createConfigCommand(): Command {
  const configCmd = new Command('config').description(
    'Manage CLI configuration',
  );

  configCmd
    .command('show')
    .description('Show current configuration')
    .action(async () => {
      try {
        const projectDir = findProject();
        if (!projectDir) {
          logger.info('No Tale project found in current directory tree.');
          logger.info('Run "tale init" to create a project.');
          return;
        }
        logger.header('Tale CLI Configuration');
        logger.table([['Project directory', projectDir]]);
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  return configCmd;
}
