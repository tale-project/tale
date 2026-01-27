import {
  getContainerHealth,
  getContainerVersion,
  isContainerRunning,
  listContainers,
} from "../docker/container";
import { getDeploymentState, type DeploymentColor } from "../state/deployment";
import { getLockInfo } from "../state/lock";
import * as logger from "../utils/logger";
import { ROTATABLE_SERVICES, STATEFUL_SERVICES } from "../compose/types";

type ServiceStatus = "healthy" | "starting" | "unhealthy" | "stopped";

const STATUS_COLORS: Record<ServiceStatus, string> = {
  healthy: "\x1b[32m",
  starting: "\x1b[33m",
  unhealthy: "\x1b[31m",
  stopped: "\x1b[31m",
};

function getServiceStatus(
  running: boolean,
  health: "healthy" | "unhealthy" | "starting" | "none"
): ServiceStatus {
  if (!running) {
    return "stopped";
  }
  if (health === "healthy") {
    return "healthy";
  }
  if (health === "starting") {
    return "starting";
  }
  return "unhealthy";
}

interface StatusOptions {
  deployDir: string;
  projectName: string;
}

export async function status(options: StatusOptions): Promise<void> {
  const { deployDir, projectName } = options;

  logger.header("Tale Deployment Status");

  // Check lock status
  const lockInfo = await getLockInfo(deployDir);
  if (lockInfo) {
    logger.warn(
      `Deployment in progress (PID: ${lockInfo.pid}, started: ${lockInfo.startedAt})`
    );
    logger.blank();
  }

  // Get deployment state
  const state = await getDeploymentState(deployDir);
  logger.info(`Active color: ${state.currentColor ?? "none"}`);
  if (state.previousVersion) {
    logger.info(`Previous version: ${state.previousVersion}`);
  }
  logger.blank();

  // Check stateful services
  logger.step("Stateful Services:");
  for (const service of STATEFUL_SERVICES) {
    const containerName = `${projectName}-${service}`;
    const running = await isContainerRunning(containerName);
    const health = await getContainerHealth(containerName);
    const version = await getContainerVersion(containerName);
    const status = getServiceStatus(running, health);
    const versionStr = version ? ` (${version})` : "";

    console.log(
      `  ${service.padEnd(12)} ${STATUS_COLORS[status]}${status}\x1b[0m${versionStr}`
    );
  }
  logger.blank();

  // Check rotatable services for each color
  for (const color of ["blue", "green"] as DeploymentColor[]) {
    const isActive = state.currentColor === color;
    const colorLabel = isActive ? `${color} (active)` : color;
    logger.step(`${colorLabel.charAt(0).toUpperCase() + colorLabel.slice(1)} Services:`);

    let hasServices = false;
    for (const service of ROTATABLE_SERVICES) {
      const containerName = `${projectName}-${service}-${color}`;
      const running = await isContainerRunning(containerName);

      if (running) {
        hasServices = true;
        const health = await getContainerHealth(containerName);
        const version = await getContainerVersion(containerName);
        const status = getServiceStatus(running, health);
        const versionStr = version ? ` (${version})` : "";

        console.log(
          `  ${service.padEnd(12)} ${STATUS_COLORS[status]}${status}\x1b[0m${versionStr}`
        );
      }
    }

    if (!hasServices) {
      console.log("  (no services running)");
    }
    logger.blank();
  }

  // Show all tale containers for reference
  const containers = await listContainers(`name=${projectName}`);
  if (containers.length > 0) {
    logger.step("All Containers:");
    for (const container of containers) {
      const statusColor = container.status.startsWith("Up")
        ? "\x1b[32m"
        : "\x1b[31m";
      console.log(
        `  ${container.name.padEnd(24)} ${statusColor}${container.status}\x1b[0m`
      );
    }
  }
}
