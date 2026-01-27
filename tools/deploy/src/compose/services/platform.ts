import type { ComposeService, DeploymentColor, ServiceConfig } from "../types";
import { DEFAULT_LOGGING } from "../types";

export function createPlatformService(
  config: ServiceConfig,
  color: DeploymentColor
): ComposeService {
  return {
    image: `${config.registry}/tale-platform:${config.version}`,
    container_name: `tale-platform-${color}`,
    volumes: ["platform-convex-data:/app/convex-data", "caddy-data:/caddy-data:ro"],
    env_file: [".env"],
    restart: "unless-stopped",
    healthcheck: {
      test: [
        "CMD-SHELL",
        "curl -sf http://localhost:3000/api/health && curl -sf http://localhost:3210/version",
      ],
      interval: "5s",
      timeout: "3s",
      retries: 3,
      start_period: "120s",
    },
    logging: DEFAULT_LOGGING,
    networks: {
      internal: {
        aliases: [`platform-${color}`, "platform"],
      },
    },
  };
}
