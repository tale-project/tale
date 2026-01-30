import { Command } from "commander";
import {
  type ServiceName,
  ALL_SERVICES,
  isValidService,
} from "../../lib/compose/types";
import { ensureConfig } from "../../lib/config/ensure-config";
import { ensureEnv } from "../../lib/config/ensure-env";
import { getDefaultDeployDir } from "../../lib/config/get-default-deploy-dir";
import { selectVersion } from "../../lib/registry/select-version";
import { loadEnv } from "../../utils/load-env";
import * as logger from "../../utils/logger";
import { deploy } from "../../lib/actions/deploy";

function getDirOptionDescription(): string {
  const defaultDir = getDefaultDeployDir();
  return defaultDir
    ? `Deployment directory (default: ${defaultDir})`
    : "Deployment directory";
}

export function createDeployCommand(): Command {
  return new Command("deploy")
    .description("Deploy a version to the environment")
    .argument("[version]", "Version to deploy (e.g., v1.0.0 or 1.0.0)")
    .option(
      "-a, --all",
      "Also update infrastructure (db, graph-db, proxy)",
      false
    )
    .option(
      "-s, --services <list>",
      `Specific services to update (comma-separated: ${ALL_SERVICES.join(",")})`
    )
    .option("--dry-run", "Preview deployment without making changes", false)
    .option("-d, --dir <path>", getDirOptionDescription())
    .option("--host <hostname>", "Host alias for proxy")
    .action(async (versionArg: string | undefined, options) => {
      try {
        const deployDir = await ensureConfig({ explicitDir: options.dir });
        const envSetupSuccess = await ensureEnv({ deployDir });
        if (!envSetupSuccess) {
          process.exit(1);
        }
        const env = loadEnv(deployDir);

        let version = versionArg?.replace(/^v/, "");
        if (!version) {
          const selected = await selectVersion(env.GHCR_REGISTRY);
          if (!selected) {
            process.exit(1);
          }
          version = selected;
        }

        let services: ServiceName[] | undefined;
        if (options.services) {
          const serviceList = options.services
            .split(",")
            .map((s: string) => s.trim());
          const invalid = serviceList.filter(
            (s: string) => !isValidService(s)
          );
          if (invalid.length > 0) {
            logger.error(`Invalid service(s): ${invalid.join(", ")}`);
            logger.info(`Valid services: ${ALL_SERVICES.join(", ")}`);
            process.exit(1);
          }
          services = serviceList as ServiceName[];
        }

        const hostAlias = options.host ?? process.env.HOST ?? "tale.local";
        await deploy({
          version,
          updateStateful: options.all,
          env,
          hostAlias,
          dryRun: options.dryRun,
          services,
        });
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
