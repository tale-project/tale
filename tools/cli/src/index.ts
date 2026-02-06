#!/usr/bin/env bun
import { program } from "commander";
import { createCleanupCommand } from "./commands/cleanup";
import { createConfigCommand } from "./commands/config";
import { createConvexCommand } from "./commands/convex";
import { createDeployCommand } from "./commands/deploy";
import { createLogsCommand } from "./commands/logs";
import { createResetCommand } from "./commands/reset";
import { createRollbackCommand } from "./commands/rollback";
import { createStatusCommand } from "./commands/status";
import pkg from "../package.json";

program
  .name("tale")
  .description("Tale CLI - deployment and management tools")
  .version(pkg.version);

program.addCommand(createConfigCommand());
program.addCommand(createConvexCommand());
program.addCommand(createDeployCommand());
program.addCommand(createStatusCommand());
program.addCommand(createLogsCommand());
program.addCommand(createRollbackCommand());
program.addCommand(createResetCommand());
program.addCommand(createCleanupCommand());

program.parse();
