import {
  type DeploymentColor,
  ROTATABLE_SERVICES,
  STATEFUL_SERVICES,
} from "../../lib/compose/types";
import { getContainerHealth } from "../../lib/docker/get-container-health";
import { getContainerVersion } from "../../lib/docker/get-container-version";
import { isContainerRunning } from "../../lib/docker/is-container-running";
import { listContainers } from "../../lib/docker/list-containers";
import { getDeploymentState } from "../../lib/state/get-deployment-state";
import { getLockInfo } from "../../lib/state/get-lock-info";
import * as logger from "../../utils/logger";

type ServiceStatus = "healthy" | "starting" | "unhealthy" | "running" | "stopped";

const STATUS_COLORS: Record<ServiceStatus, string> = {
  healthy: "\x1b[32m",
  running: "\x1b[32m",
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
  if (health === "unhealthy") {
    return "unhealthy";
  }
  return "running";
}

interface StatusOptions {
  deployDir: string;
  projectName: string;
}

async function getContainerStatus(containerName: string) {
  const [running, health, version] = await Promise.all([
    isContainerRunning(containerName),
    getContainerHealth(containerName),
    getContainerVersion(containerName),
  ]);
  return { running, health, version };
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

  // Check stateful services in parallel
  logger.step("Stateful Services:");
  const statefulResults = await Promise.all(
    STATEFUL_SERVICES.map(async (service) => {
      const containerName = `${projectName}-${service}`;
      const info = await getContainerStatus(containerName);
      return { service, ...info };
    })
  );
  for (const { service, running, health, version } of statefulResults) {
    const serviceStatus = getServiceStatus(running, health);
    const versionStr = version ? ` (${version})` : "";
    console.log(
      `  ${service.padEnd(12)} ${STATUS_COLORS[serviceStatus]}${serviceStatus}\x1b[0m${versionStr}`
    );
  }
  logger.blank();

  // Check rotatable services for each color
  for (const color of ["blue", "green"] as DeploymentColor[]) {
    const isActive = state.currentColor === color;
    const colorLabel = isActive ? `${color} (active)` : color;
    logger.step(`${colorLabel.charAt(0).toUpperCase() + colorLabel.slice(1)} Services:`);

    const rotatableResults = await Promise.all(
      ROTATABLE_SERVICES.map(async (service) => {
        const containerName = `${projectName}-${service}-${color}`;
        const info = await getContainerStatus(containerName);
        return { service, ...info };
      })
    );

    let hasServices = false;
    for (const { service, running, health, version } of rotatableResults) {
      if (running) {
        hasServices = true;
        const serviceStatus = getServiceStatus(running, health);
        const versionStr = version ? ` (${version})` : "";
        console.log(
          `  ${service.padEnd(12)} ${STATUS_COLORS[serviceStatus]}${serviceStatus}\x1b[0m${versionStr}`
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
