import {
  type DeploymentColor,
  ROTATABLE_SERVICES,
  type ServiceName,
  STATEFUL_SERVICES,
} from "../compose/types";
import { isContainerRunning } from "../docker/client";
import { getCurrentColor } from "../state/deployment";
import * as logger from "../utils/logger";

interface LogsOptions {
  service: string;
  color?: DeploymentColor;
  follow: boolean;
  since?: string;
  tail?: number;
  deployDir: string;
  projectName: string;
}

function isValidService(service: string): service is ServiceName {
  return (
    ROTATABLE_SERVICES.includes(service as (typeof ROTATABLE_SERVICES)[number]) ||
    STATEFUL_SERVICES.includes(service as (typeof STATEFUL_SERVICES)[number])
  );
}

function isRotatableService(
  service: string
): service is (typeof ROTATABLE_SERVICES)[number] {
  return ROTATABLE_SERVICES.includes(
    service as (typeof ROTATABLE_SERVICES)[number]
  );
}

export async function logsCommand(options: LogsOptions): Promise<void> {
  const { service, color, follow, since, tail, deployDir, projectName } =
    options;

  // Validate service name
  if (!isValidService(service)) {
    const allServices = [...ROTATABLE_SERVICES, ...STATEFUL_SERVICES];
    logger.error(`Invalid service: ${service}`);
    logger.info(`Available services: ${allServices.join(", ")}`);
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

  await proc.exited;
}
