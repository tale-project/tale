#!/usr/bin/env bun
import { program } from 'commander';

import pkg from '../package.json';
import { createAuthCommand } from './commands/auth';
import { createBackupCommand } from './commands/backup';
import { createCleanupCommand } from './commands/cleanup';
import { createConfigCommand } from './commands/config';
import { createConvexCommand } from './commands/convex';
import { createDaemonCommand } from './commands/daemon';
import { createDeployCommand } from './commands/deploy';
import { createInitCommand } from './commands/init';
import { createLogsCommand } from './commands/logs';
import { createMigrateCommand } from './commands/migrate';
import { createResetCommand } from './commands/reset';
import { createRestoreCommand } from './commands/restore';
import { createRollbackCommand } from './commands/rollback';
import { createStartCommand } from './commands/start';
import { createStatusCommand } from './commands/status';
import { createUpgradeCommand } from './commands/upgrade';
import * as logger from './utils/logger';
import {
  configureOutput,
  type GlobalFlags,
  resolveOutputMode,
  setActiveOutputMode,
} from './utils/output-mode';
import { handleError } from './utils/run-command';

// A stray crash/rejection is routed through the same dispatch as a command
// error, so it gets a coded, rendered failure instead of a raw stack trace.
process.on('uncaughtException', (err) => handleError(err));
process.on('unhandledRejection', (reason) => handleError(reason));

program
  .name('tale')
  .description('Tale CLI - deployment and management tools')
  // Default version flag stays `-V, --version`; `-v` is free for --verbose.
  .version(pkg.version)
  .option('-v, --verbose', 'verbose output (debug logs, raw passthrough)')
  .option('-q, --quiet', 'only warnings and errors')
  .option('-y, --yes', 'assume "yes" for all prompts (non-interactive)')
  .option(
    '--no-color',
    'disable ANSI color (also honors NO_COLOR / FORCE_COLOR)',
  )
  .option('--json', 'machine-readable JSON on stdout, human chrome on stderr')
  .option(
    '--ci',
    'force non-interactive, append-only output (no cursor escapes)',
  )
  .showHelpAfterError('(add --help for a list of commands)');

// Resolve the global flags into ONE output mode and apply it before any command
// runs, so every command inherits the same color/verbosity/json configuration.
// Global flags go before the subcommand: `tale --json status`.
program.hook('preAction', () => {
  const mode = resolveOutputMode(program.opts<GlobalFlags>());
  configureOutput(mode);
  setActiveOutputMode(mode);
});

// Group headings keep the command list scannable. Commander renders each
// command under its `helpGroup` heading instead of one flat list.
const SETUP = 'Setup:';
const OPERATE = 'Operate:';
const MAINTAIN = 'Maintain:';
const ADVANCED = 'Advanced:';

program.addCommand(createInitCommand().helpGroup(SETUP));
program.addCommand(createStartCommand().helpGroup(SETUP));
program.addCommand(createDeployCommand().helpGroup(SETUP));

program.addCommand(createStatusCommand().helpGroup(OPERATE));
program.addCommand(createLogsCommand().helpGroup(OPERATE));
program.addCommand(createBackupCommand().helpGroup(OPERATE));
program.addCommand(createRestoreCommand().helpGroup(OPERATE));
program.addCommand(createRollbackCommand().helpGroup(OPERATE));

program.addCommand(createUpgradeCommand().helpGroup(MAINTAIN));
program.addCommand(createMigrateCommand().helpGroup(MAINTAIN));
program.addCommand(createCleanupCommand().helpGroup(MAINTAIN));
program.addCommand(createResetCommand().helpGroup(MAINTAIN));
program.addCommand(createConfigCommand().helpGroup(MAINTAIN));

program.addCommand(createAuthCommand().helpGroup(ADVANCED));
program.addCommand(createConvexCommand().helpGroup(ADVANCED));
program.addCommand(createDaemonCommand().helpGroup(ADVANCED));

// Docs link honors TALE_DOCS_URL (mirrors @tale/ui/seo/globals) so a
// self-hosted or staging deployment can point users at its own docs; the
// default is the public docs site at https://tale.dev/docs.
const DOCS_URL =
  process.env.TALE_DOCS_URL ??
  `${process.env.TALE_SITE_URL ?? 'https://tale.dev'}/docs`;

// Branded wordmark above the help, and a few real examples below it.
program.addHelpText('beforeAll', () => `\n${logger.bannerText(pkg.version)}\n`);
program.addHelpText(
  'after',
  [
    '',
    'Examples:',
    '  tale init my-workspace        scaffold a new project',
    '  tale start                    run it locally (Ctrl-C to stop)',
    '  tale status --json            machine-readable status',
    '  tale deploy --verbose         deploy with full subprocess output',
    '',
    'Global flags: --verbose  --quiet  --yes  --no-color  --json  --ci',
    '',
    `Docs: ${DOCS_URL}`,
    '',
  ].join('\n'),
);

// Bare `tale` shows the branded, grouped overview instead of an error.
if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

try {
  await program.parseAsync();
} catch (err) {
  handleError(err);
}
