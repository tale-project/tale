import { docker } from "../docker/docker";
import { isContainerRunning } from "../docker/is-container-running";
import { listContainers } from "../docker/list-containers";
import * as logger from "../../utils/logger";

async function findPlatformContainer(): Promise<string> {
  if (await isContainerRunning("tale-platform-blue")) {
    return "tale-platform-blue";
  }
  if (await isContainerRunning("tale-platform-green")) {
    return "tale-platform-green";
  }

  const containers = await listContainers("name=tale");
  const platform = containers.find(
    (c) => /platform/.test(c.name) && c.status.startsWith("Up")
  );
  if (platform) {
    return platform.name;
  }

  throw new Error(
    "No platform container is running. Start the platform first with: tale deploy"
  );
}

export async function convexAdmin(): Promise<void> {
  logger.step("Detecting platform container...");

  const container = await findPlatformContainer();
  logger.info(`Using container: ${container}`);
  logger.blank();

  const result = await docker("exec", container, "./generate-admin-key.sh");
  if (!result.success) {
    throw new Error(result.stderr || "Failed to generate admin key");
  }

  console.log(result.stdout);
}
