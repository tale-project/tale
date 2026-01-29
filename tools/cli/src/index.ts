#!/usr/bin/env bun
import { program } from "commander";
import { createDeployCommand } from "./commands/deploy";

const VERSION = "1.0.0";

program
  .name("tale")
  .description("Tale CLI - deployment and management tools")
  .version(VERSION);

program.addCommand(createDeployCommand());

program.parse();
