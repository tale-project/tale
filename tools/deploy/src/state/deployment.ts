import { existsSync } from "node:fs";
import type { DeploymentColor } from "../compose/types";
import * as logger from "../utils/logger";

export type { DeploymentColor } from "../compose/types";

const STATE_FILE = ".deployment-color";
const PREVIOUS_VERSION_FILE = ".deployment-previous-version";

export function getStateFilePath(deployDir: string): string {
  return `${deployDir}/${STATE_FILE}`;
}

export function getPreviousVersionFilePath(deployDir: string): string {
  return `${deployDir}/${PREVIOUS_VERSION_FILE}`;
}

export async function getCurrentColor(
  deployDir: string
): Promise<DeploymentColor | null> {
  const statePath = getStateFilePath(deployDir);

  if (!existsSync(statePath)) {
    return null;
  }

  const content = await Bun.file(statePath).text();
  const color = content.trim() as DeploymentColor;

  if (color !== "blue" && color !== "green") {
    logger.warn(`Invalid color in state file: ${color}`);
    return null;
  }

  return color;
}

export async function setCurrentColor(
  deployDir: string,
  color: DeploymentColor
): Promise<void> {
  const statePath = getStateFilePath(deployDir);
  await Bun.write(statePath, color);
  logger.debug(`Set deployment color to: ${color}`);
}

export function getNextColor(current: DeploymentColor | null): DeploymentColor {
  if (current === "blue") {
    return "green";
  }
  return "blue";
}

export function getOppositeColor(color: DeploymentColor): DeploymentColor {
  return color === "blue" ? "green" : "blue";
}

export async function getPreviousVersion(
  deployDir: string
): Promise<string | null> {
  const versionPath = getPreviousVersionFilePath(deployDir);

  if (!existsSync(versionPath)) {
    return null;
  }

  const content = await Bun.file(versionPath).text();
  return content.trim() || null;
}

export async function setPreviousVersion(
  deployDir: string,
  version: string
): Promise<void> {
  const versionPath = getPreviousVersionFilePath(deployDir);
  await Bun.write(versionPath, version);
  logger.debug(`Saved previous version: ${version}`);
}

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
