import type { ComposeService, DeploymentColor, ServiceConfig } from "../types";
import { DEFAULT_LOGGING } from "../types";

export function createOperatorService(
  config: ServiceConfig,
  color: DeploymentColor
): ComposeService {
  return {
    image: `${config.registry}/tale-operator:${config.version}`,
    container_name: `${config.projectName}-operator-${color}`,
    env_file: [".env"],
    restart: "unless-stopped",
    healthcheck: {
      test: [
        "CMD",
        "curl",
        "-f",
        "http://localhost:8004/health",
      ],
      interval: "30s",
      timeout: "10s",
      retries: 3,
      start_period: "60s",
    },
    logging: DEFAULT_LOGGING,
    networks: {
      internal: {
        aliases: ["operator", `operator-${color}`],
      },
    },
  };
}
