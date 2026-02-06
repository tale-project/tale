import type { ComposeService, DeploymentColor, ServiceConfig } from "../types";
import { DEFAULT_LOGGING } from "../types";

export function createCrawlerService(
  config: ServiceConfig,
  color: DeploymentColor
): ComposeService {
  return {
    image: `${config.registry}/tale-crawler:${config.version}`,
    container_name: `${config.projectName}-crawler-${color}`,
    env_file: [".env"],
    restart: "unless-stopped",
    healthcheck: {
      test: ["CMD", "curl", "-f", "http://localhost:8002/health"],
      interval: "5s",
      timeout: "3s",
      retries: 2,
      start_period: "40s",
    },
    logging: DEFAULT_LOGGING,
    networks: {
      internal: {
        aliases: ["crawler", `crawler-${color}`],
      },
    },
  };
}
