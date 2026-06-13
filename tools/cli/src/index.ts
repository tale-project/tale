#!/usr/bin/env bun
import { program } from 'commander';

import pkg from '../package.json';
import { createAuthCommand } from './commands/auth';
import { createBackupCommand } from './commands/backup';
import { createCleanupCommand } from './commands/cleanup';
import { createConfigCommand } from './commands/config';
import { createConvexCommand } from './commands/convex';
import { createDeployCommand } from './commands/deploy';
import { createDoctorCommand } from './commands/doctor';
import { createInitCommand } from './commands/init';
import { createLogsCommand } from './commands/logs';
import { createMigrateCommand } from './commands/migrate';
import { createResetCommand } from './commands/reset';
import { createRestoreCommand } from './commands/restore';
import { createRollbackCommand } from './commands/rollback';
import { createSetupCommand } from './commands/setup';
import { createStartCommand } from './commands/start';
import { createStatusCommand } from './commands/status';
import { createUpgradeCommand } from './commands/upgrade';
import * as logger from './utils/logger';

process.on('uncaughtException', (err) => {
  logger.error(`Fatal: ${err.message}`);
  logger.debug(err.stack ?? '');
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  logger.error(`Fatal: ${msg}`);
  if (reason instanceof Error) logger.debug(reason.stack ?? '');
  process.exit(1);
});

program
  .name('tale')
  .description('Tale CLI - deployment and management tools')
  .version(pkg.version)
  .showHelpAfterError('(add --help for a list of commands)');

// Group headings keep the command list scannable. Commander renders each
// command under its `helpGroup` heading instead of one flat list.
const SETUP = 'Setup:';
const OPERATE = 'Operate:';
const MAINTAIN = 'Maintain:';
const ADVANCED = 'Advanced:';

program.addCommand(createSetupCommand().helpGroup(SETUP));
program.addCommand(createInitCommand().helpGroup(SETUP));
program.addCommand(createStartCommand().helpGroup(SETUP));
program.addCommand(createDeployCommand().helpGroup(SETUP));

program.addCommand(createStatusCommand().helpGroup(OPERATE));
program.addCommand(createLogsCommand().helpGroup(OPERATE));
program.addCommand(createBackupCommand().helpGroup(OPERATE));
program.addCommand(createRestoreCommand().helpGroup(OPERATE));
program.addCommand(createRollbackCommand().helpGroup(OPERATE));

program.addCommand(createUpgradeCommand().helpGroup(MAINTAIN));
program.addCommand(createCleanupCommand().helpGroup(MAINTAIN));
program.addCommand(createResetCommand().helpGroup(MAINTAIN));
program.addCommand(createDoctorCommand().helpGroup(MAINTAIN));
program.addCommand(createConfigCommand().helpGroup(MAINTAIN));

program.addCommand(createAuthCommand().helpGroup(ADVANCED));
program.addCommand(createConvexCommand().helpGroup(ADVANCED));
// Deprecated (forward migration now runs automatically on start/deploy/update);
// keep it working for the `config-layout --cleanup-old` step but hide it from
// `tale --help` so the top-level listing stays clean.
program.addCommand(createMigrateCommand().helpGroup(ADVANCED), {
  hidden: true,
});

// Branded wordmark above the help, and a few real examples below it.
program.addHelpText('beforeAll', () => `\n${logger.bannerText(pkg.version)}\n`);
program.addHelpText(
  'after',
  [
    '',
    'Examples:',
    '  $ tale setup                 Install Docker (if needed) and scaffold a project',
    '  $ tale init                  Create a project — pick local trial or production',
    '  $ tale start                 Launch locally (self-signed TLS)',
    '  $ tale deploy                Deploy to your domain (zero-downtime)',
    '',
    'Docs: https://docs.tale.dev',
    '',
  ].join('\n'),
);

// Bare `tale` shows the branded, grouped overview instead of an error.
if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

await program.parseAsync();
