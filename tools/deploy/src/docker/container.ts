import { docker } from "./exec";
import * as logger from "../utils/logger";

export async function getContainerHealth(
  containerName: string
): Promise<"healthy" | "unhealthy" | "starting" | "none"> {
  const result = await docker(
    "inspect",
    "--format",
    "{{.State.Health.Status}}",
    containerName
  );

  if (!result.success) {
    return "none";
  }

  const status = result.stdout.trim();
  if (status === "healthy" || status === "unhealthy" || status === "starting") {
    return status;
  }
  return "none";
}

export async function isContainerRunning(containerName: string): Promise<boolean> {
  const result = await docker(
    "inspect",
    "--format",
    "{{.State.Running}}",
    containerName
  );
  return result.success && result.stdout.trim() === "true";
}

export async function stopContainer(containerName: string): Promise<boolean> {
  logger.info(`Stopping container: ${containerName}`);
  const result = await docker("stop", containerName);
  return result.success;
}

export async function removeContainer(containerName: string): Promise<boolean> {
  logger.info(`Removing container: ${containerName}`);
  const result = await docker("rm", "-f", containerName);
  return result.success;
}

export async function getContainerVersion(
  containerName: string
): Promise<string | null> {
  const result = await docker(
    "inspect",
    "--format",
    '{{index .Config.Labels "org.opencontainers.image.version"}}',
    containerName
  );

  if (!result.success || !result.stdout.trim()) {
    return null;
  }

  return result.stdout.trim();
}

export async function listContainers(
  filter?: string
): Promise<{ name: string; status: string; image: string }[]> {
  const args = ["ps", "-a", "--format", "{{.Names}}\t{{.Status}}\t{{.Image}}"];
  if (filter) {
    args.push("--filter", filter);
  }

  const result = await docker(...args);
  if (!result.success || !result.stdout) {
    return [];
  }

  return result.stdout.split("\n").map((line) => {
    const [name, status, image] = line.split("\t");
    return { name, status, image };
  });
}
