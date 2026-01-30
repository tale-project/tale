import type { DeploymentColor } from "../compose/types";
import { getCurrentColor } from "./get-current-color";
import { getPreviousVersion } from "./get-previous-version";

export interface DeploymentState {
  currentColor: DeploymentColor | null;
  previousVersion: string | null;
}

export async function getDeploymentState(
  deployDir: string
): Promise<DeploymentState> {
  const [currentColor, previousVersion] = await Promise.all([
    getCurrentColor(deployDir),
    getPreviousVersion(deployDir),
  ]);

  return { currentColor, previousVersion };
}
