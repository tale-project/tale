#!/usr/bin/env node
/**
 * `tale-load` — the Tale smoke, stress and performance harness.
 *
 * Runs on Node 22 directly from the TypeScript sources (Node strips the
 * types), so a load generator needs nothing but a checkout and `bun install`:
 *
 *   node tools/load/src/cli.ts mock --port 4199
 *   node tools/load/src/cli.ts seed --target http://127.0.0.1:4105 --users 1000
 *
 * Each command lives with its own module and mounts here.
 */

import { Command } from 'commander';

import { createMockCommand } from './mock/main.ts';
import { createMergeCommand, createRunCommand } from './runner/command.ts';
import { createSeedCommand } from './seed/cli.ts';
import { createStackCommand } from './stack/command.ts';

const program = new Command('tale-load')
  .description(
    'Smoke, stress and performance harness for Tale: realistic virtual users against a deployment, with a realistic mock model provider',
  )
  .showHelpAfterError();

program.addCommand(createMockCommand());
program.addCommand(createSeedCommand());
program.addCommand(createRunCommand());
program.addCommand(createMergeCommand());
program.addCommand(createStackCommand());

await program.parseAsync(process.argv);
