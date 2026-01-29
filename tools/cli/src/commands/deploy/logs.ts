import type { DeploymentColor } from "../../lib/compose/types";
import { isRotatableService, isValidService } from "../../lib/compose/types";
import { isContainerRunning } from "../../lib/docker/is-container-running";
import { getCurrentColor } from "../../lib/state/get-current-color";
import * as logger from "../../utils/logger";

interface LogsOptions {
  service: string;
  color?: DeploymentColor;
  follow: boolean;
  since?: string;
  tail?: number;
  deployDir: string;
  projectName: string;
}

export async function logs(options: LogsOptions): Promise<void> {
  const { service, color, follow, since, tail, deployDir, projectName } =
    options;

  // Validate service name
  if (!isValidService(service)) {
    logger.error(`Invalid service: ${service}`);
    logger.info(`Available services: platform, rag, crawler, search, db, graph-db, proxy`);
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

    containerName = `${projectName}-${service}-${targetColor}`;
  } else {
    // Stateful services don't have colors
    if (color) {
      logger.warn(
        `Ignoring --color for stateful service ${service} (stateful services don't use blue/green)`
      );
    }
    containerName = `${projectName}-${service}`;
  }

  // Check if container is running
  const running = await isContainerRunning(containerName);
  if (!running) {
    logger.error(`Container ${containerName} is not running`);
    throw new Error("Container not running");
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
  if (exitCode !== 0) {
    throw new Error(`docker logs exited with code ${exitCode}`);
  }
}
