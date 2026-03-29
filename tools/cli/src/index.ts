#!/usr/bin/env bun
import { program } from 'commander';

import pkg from '../package.json';
import { createCleanupCommand } from './commands/cleanup';
import { createConfigCommand } from './commands/config';
import { createConvexCommand } from './commands/convex';
import { createDeployCommand } from './commands/deploy';
import { createInitCommand } from './commands/init';
import { createLogsCommand } from './commands/logs';
import { createResetCommand } from './commands/reset';
import { createRollbackCommand } from './commands/rollback';
import { createStartCommand } from './commands/start';
import { createStatusCommand } from './commands/status';
import { createUpdateCommand } from './commands/update';

program
  .name('tale')
  .description('Tale CLI - deployment and management tools')
  .version(pkg.version);

program.addCommand(createInitCommand());
program.addCommand(createStartCommand());
program.addCommand(createUpdateCommand());
program.addCommand(createConfigCommand());
program.addCommand(createConvexCommand());
program.addCommand(createDeployCommand());
program.addCommand(createStatusCommand());
program.addCommand(createLogsCommand());
program.addCommand(createRollbackCommand());
program.addCommand(createResetCommand());
program.addCommand(createCleanupCommand());

program.parse();
