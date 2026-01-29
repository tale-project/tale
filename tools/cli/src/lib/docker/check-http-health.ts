import type { HealthCheckOptions } from "./wait-for-healthy";
import * as logger from "../../utils/logger";

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
