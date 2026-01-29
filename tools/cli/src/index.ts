#!/usr/bin/env bun
import { program } from "commander";
import { createConfigCommand } from "./commands/config";
import { createDeployCommand } from "./commands/deploy";
import { createLogsCommand } from "./commands/logs";
import { createStatusCommand } from "./commands/status";
import pkg from "../package.json";

program
  .name("tale")
  .description("Tale CLI - deployment and management tools")
  .version(pkg.version);

program.addCommand(createConfigCommand());
program.addCommand(createDeployCommand());
program.addCommand(createStatusCommand());
program.addCommand(createLogsCommand());

program.parse();
