import { Command } from 'commander';

import pkg from '../../../package.json';
import { findProject } from '../../lib/project/find-project';
import { emitJson } from '../../utils/json-output';
import * as logger from '../../utils/logger';
import { getOutputMode } from '../../utils/output-mode';
import { action } from '../../utils/run-command';

export function createConfigCommand(): Command {
  const configCmd = new Command('config').description(
    'Manage CLI configuration',
  );

  configCmd
    .command('show')
    .description('Show current configuration')
    .action(
      action(async () => {
        const projectDir = findProject();
        // No project here is a valid state, not an error (exit 0).
        if (!projectDir) {
          if (getOutputMode().json) {
            emitJson('config', { projectDir: null, cliVersion: pkg.version });
            return;
          }
          logger.info('No Tale project found in current directory tree.');
          logger.info('Run "tale init" to create a project.');
          return;
        }
        if (getOutputMode().json) {
          emitJson('config', { projectDir, cliVersion: pkg.version });
          return;
        }
        logger.header('Tale CLI Configuration');
        logger.table([
          ['Project directory', projectDir],
          ['CLI version', pkg.version],
        ]);
      }),
    );

  return configCmd;
}
