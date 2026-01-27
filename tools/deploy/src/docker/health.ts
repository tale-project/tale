import * as logger from "../utils/logger";
import { getContainerHealth, isContainerRunning } from "./client";

export interface HealthCheckOptions {
  timeout: number;
  interval?: number;
}

export async function waitForHealthy(
  containerName: string,
  options: HealthCheckOptions
): Promise<boolean> {
  const { timeout, interval = 2000 } = options;
  const startTime = Date.now();
  const timeoutMs = timeout * 1000;

  logger.info(`Waiting for ${containerName} to become healthy (timeout: ${timeout}s)`);

  while (Date.now() - startTime < timeoutMs) {
    const isRunning = await isContainerRunning(containerName);
    if (!isRunning) {
      logger.warn(`Container ${containerName} is not running`);
      await Bun.sleep(interval);
      continue;
    }

    const health = await getContainerHealth(containerName);

    if (health === "healthy") {
      logger.success(`${containerName} is healthy`);
      return true;
    }

    if (health === "unhealthy") {
      logger.error(`${containerName} is unhealthy`);
      return false;
    }

    logger.debug(`${containerName} health status: ${health}`);
    await Bun.sleep(interval);
  }

  logger.error(`Timeout waiting for ${containerName} to become healthy`);
  return false;
}

export async function checkHttpHealth(
  url: string,
  options: HealthCheckOptions
): Promise<boolean> {
  const { timeout, interval = 2000 } = options;
  const startTime = Date.now();
  const timeoutMs = timeout * 1000;

  logger.info(`Checking HTTP health: ${url} (timeout: ${timeout}s)`);

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        logger.success(`HTTP health check passed: ${url}`);
        return true;
      }

      logger.debug(`HTTP health check returned ${response.status}`);
    } catch (err) {
      logger.debug(`HTTP health check failed: ${err}`);
    }

    await Bun.sleep(interval);
  }

  logger.error(`Timeout waiting for HTTP health: ${url}`);
  return false;
}
