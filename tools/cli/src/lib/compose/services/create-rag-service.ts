import { PROJECT_NAME } from "../../../utils/load-env";
import type { ComposeService, DeploymentColor, ServiceConfig } from "../types";
import { DEFAULT_LOGGING } from "../types";

export function createRagService(
  config: ServiceConfig,
  color: DeploymentColor
): ComposeService {
  return {
    image: `${config.registry}/tale-rag:${config.version}`,
    container_name: `${PROJECT_NAME}-rag-${color}`,
    volumes: ["rag-data:/app/data"],
    env_file: [".env"],
    restart: "unless-stopped",
    healthcheck: {
      test: ["CMD", "curl", "-f", "http://localhost:8001/health"],
      interval: "5s",
      timeout: "3s",
      retries: 2,
      start_period: "40s",
    },
    logging: DEFAULT_LOGGING,
    networks: {
      internal: {
        aliases: ["rag", `rag-${color}`],
      },
    },
  };
}
