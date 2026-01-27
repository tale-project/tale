import type { DeploymentColor } from "../compose/types";
import * as logger from "../utils/logger";
import { getStateFilePath } from "./get-state-file-path";

export async function setCurrentColor(
  deployDir: string,
  color: DeploymentColor
): Promise<void> {
  const statePath = getStateFilePath(deployDir);
  await Bun.write(statePath, color);
  logger.debug(`Set deployment color to: ${color}`);
}
