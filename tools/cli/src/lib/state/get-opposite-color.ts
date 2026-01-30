import type { DeploymentColor } from "../compose/types";

export function getOppositeColor(color: DeploymentColor): DeploymentColor {
  return color === "blue" ? "green" : "blue";
}
