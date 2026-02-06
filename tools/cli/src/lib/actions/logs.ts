import type { DeploymentColor } from "../compose/types";
import { ALL_SERVICES, isRotatableService, isValidService } from "../compose/types";
import { containerExists } from "../docker/container-exists";
import { getCurrentColor } from "../state/get-current-color";
import { PROJECT_NAME } from "../../utils/load-env";
import * as logger from "../../utils/logger";

interface LogsOptions {
  service: string;
  color?: DeploymentColor;
  follow: boolean;
  since?: string;
  tail?: number;
  deployDir: string;
}

export async function logs(options: LogsOptions): Promise<void> {
  const { service, color, follow, since, tail, deployDir } = options;

  // Validate service name
  if (!isValidService(service)) {
    logger.error(`Invalid service: ${service}`);
    logger.info(`Available services: ${ALL_SERVICES.join(", ")}`);
    throw new Error("Invalid service name");
  }

  // Determine container name
  let containerName: string;

  if (isRotatableService(service)) {
    // Rotatable services need a color
    let targetColor: DeploymentColor;

    if (color) {
      targetColor = color;
    } else {
      // Auto-detect from current deployment state
      const currentColor = await getCurrentColor(deployDir);
      if (!currentColor) {
        logger.error("No active deployment found");
        logger.info("Use --color to specify blue or green explicitly");
        throw new Error("No active deployment");
      }
      targetColor = currentColor;
      logger.info(`Auto-detected active color: ${targetColor}`);
    }

    containerName = `${PROJECT_NAME}-${service}-${targetColor}`;
  } else {
    // Stateful services don't have colors
    if (color) {
      logger.warn(
        `Ignoring --color for stateful service ${service} (stateful services don't use blue/green)`
      );
    }
    containerName = `${PROJECT_NAME}-${service}`;
  }

  // Check if container exists (docker logs works for both running and stopped containers)
  const exists = await containerExists(containerName);
  if (!exists) {
    logger.error(`Container ${containerName} does not exist`);
    throw new Error("Container not found");
  }

  // Build docker logs command
  const args = ["logs"];

  if (follow) {
    args.push("--follow");
  }

  if (since) {
    args.push("--since", since);
  }

  if (tail !== undefined) {
    args.push("--tail", String(tail));
  }

  args.push(containerName);

  logger.info(`Showing logs for ${containerName}...`);
  logger.blank();

  // Use Bun.spawn with inherit to stream output directly to terminal
  const proc = Bun.spawn(["docker", ...args], {
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;
  // 130 = SIGINT (Ctrl+C), 143 = SIGTERM - expected when user stops following
  if (exitCode !== 0 && exitCode !== 130 && exitCode !== 143) {
    throw new Error(`docker logs exited with code ${exitCode}`);
  }
}
