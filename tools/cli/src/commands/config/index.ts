import { unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { getConfig } from "../../lib/config/get-config";
import { getConfigFilePath } from "../../lib/config/get-config-file-path";
import { setConfig } from "../../lib/config/set-config";
import { CURRENT_CONFIG_VERSION } from "../../lib/config/types";
import * as logger from "../../utils/logger";

export function createConfigCommand(): Command {
  const configCmd = new Command("config").description(
    "Manage CLI configuration"
  );

  configCmd
    .command("show")
    .description("Show current configuration")
    .action(async () => {
      try {
        const config = await getConfig();
        if (!config) {
          logger.info("No configuration found");
          logger.info("Run any deploy command to set up configuration");
          return;
        }
        logger.header("Tale CLI Configuration");
        logger.table([
          ["Config file", getConfigFilePath()],
          ["Deploy directory", config.deployDir],
          ["Config version", String(config.configVersion)],
        ]);
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  configCmd
    .command("set-dir")
    .description("Set the default deployment directory")
    .argument("<path>", "New deployment directory path")
    .action(async (path: string) => {
      try {
        let deployDir = path;
        if (deployDir.startsWith("~")) {
          deployDir = join(homedir(), deployDir.slice(1));
        }

        const config = await getConfig();
        await setConfig({
          deployDir,
          configVersion: config?.configVersion ?? CURRENT_CONFIG_VERSION,
        });
        logger.success(`Deployment directory set to: ${deployDir}`);
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  configCmd
    .command("reset")
    .description("Reset configuration (re-run first-time setup)")
    .action(async () => {
      try {
        await unlink(getConfigFilePath());
        logger.success("Configuration reset. Run any command to set up again.");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          logger.error(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
        logger.info("No configuration to reset");
      }
    });

  return configCmd;
}
