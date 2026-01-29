import * as logger from "../../utils/logger";
import { type VersionInfo, getAvailableVersions } from "./get-available-versions";

const isTTY = process.stdin.isTTY && process.stdout.isTTY;

async function promptForManualVersion(): Promise<string> {
  const { input } = await import("@inquirer/prompts");
  const version = await input({
    message: "Enter version to deploy:",
    validate: (value) => {
      if (!value.trim()) {
        return "Version cannot be empty";
      }
      return true;
    },
  });
  return version.replace(/^v/, "");
}

async function promptForLogin(): Promise<boolean> {
  const { confirm } = await import("@inquirer/prompts");

  logger.blank();
  logger.warn("Docker authentication required for ghcr.io");
  logger.blank();
  logger.info("To authenticate, you need a GitHub Personal Access Token (PAT)");
  logger.info("with 'read:packages' scope.");
  logger.blank();
  logger.info("Create a token at: https://github.com/settings/tokens");
  logger.blank();

  const shouldLogin = await confirm({
    message: "Would you like to login now?",
    default: true,
  });

  if (!shouldLogin) {
    return false;
  }

  logger.blank();
  logger.info("Run the following command to login:");
  logger.blank();
  logger.info("  docker login ghcr.io -u YOUR_GITHUB_USERNAME");
  logger.blank();
  logger.info("When prompted for password, paste your Personal Access Token.");
  logger.blank();

  const { confirm: confirmDone } = await import("@inquirer/prompts");
  const done = await confirmDone({
    message: "Press Enter after you have logged in...",
    default: true,
  });

  return done;
}

function formatVersionChoice(version: VersionInfo): { name: string; value: string } {
  const aliases = version.aliases.length > 0
    ? ` → ${version.aliases.join(", ")}`
    : "";

  // For "latest", use the semantic version alias if available
  let value = version.tag;
  if (version.tag === "latest") {
    const semanticAlias = version.aliases.find((a) => /^\d+\.\d+\.\d+/.test(a));
    if (semanticAlias) {
      value = semanticAlias;
    }
  }

  return {
    name: `${version.tag}${aliases}`,
    value,
  };
}

export async function selectVersion(registry: string): Promise<string | null> {
  if (!isTTY) {
    logger.error("No version specified");
    logger.blank();
    logger.info("Usage: tale deploy <version>");
    logger.info("Example: tale deploy v1.0.0");
    return null;
  }

  logger.info("Fetching available versions...");
  let result = await getAvailableVersions(registry, 10);

  // Handle authentication errors
  if (result.error === "no_auth" || result.error === "auth_failed") {
    const loggedIn = await promptForLogin();
    if (loggedIn) {
      logger.blank();
      logger.info("Retrying...");
      result = await getAvailableVersions(registry, 10);
    }
  }

  // If still no versions, fall back to manual input
  if (result.versions.length === 0) {
    if (result.error === "no_auth" || result.error === "auth_failed") {
      logger.warn("Still unable to fetch versions. Please enter manually.");
    } else if (result.error === "network") {
      logger.warn("Network error. Please check your connection.");
    } else {
      logger.warn("Could not fetch available versions from registry.");
    }
    logger.blank();
    return promptForManualVersion();
  }

  const { select } = await import("@inquirer/prompts");
  const recentVersions = result.versions.slice(0, 5);

  const choice = await select({
    message: "Select version to deploy:",
    choices: [
      ...recentVersions.map(formatVersionChoice),
      {
        name: "Enter custom version...",
        value: "__custom__",
      },
    ],
  });

  if (choice === "__custom__") {
    return promptForManualVersion();
  }

  return choice.replace(/^v/, "");
}
