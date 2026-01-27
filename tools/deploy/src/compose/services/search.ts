import type { ComposeService, DeploymentColor, ServiceConfig } from "../types";
import { DEFAULT_LOGGING } from "../types";

export function createSearchService(
  config: ServiceConfig,
  color: DeploymentColor
): ComposeService {
  return {
    image: `${config.registry}/tale-search:${config.version}`,
    container_name: `tale-search-${color}`,
    env_file: [".env"],
    restart: "unless-stopped",
    healthcheck: {
      test: [
        "CMD",
        "wget",
        "--no-verbose",
        "--tries=1",
        "--spider",
        "--header=X-Real-IP: 127.0.0.1",
        "http://localhost:8080/healthz",
      ],
      interval: "5s",
      timeout: "3s",
      retries: 2,
      start_period: "30s",
    },
    logging: DEFAULT_LOGGING,
    networks: [
      {
        internal: {
          aliases: [`search-${color}`, "search"],
        },
      },
    ],
  };
}
