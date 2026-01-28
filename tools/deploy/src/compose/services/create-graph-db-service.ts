import type { ComposeService, ServiceConfig } from "../types";
import { DEFAULT_LOGGING } from "../types";

export function createGraphDbService(config: ServiceConfig): ComposeService {
  return {
    image: `${config.registry}/tale-graph-db:${config.version}`,
    container_name: `${config.projectName}-graph-db`,
    volumes: ["graph-db-data:/var/lib/falkordb/data"],
    env_file: [".env"],
    restart: "unless-stopped",
    healthcheck: {
      test: ["CMD", "redis-cli", "ping"],
      interval: "10s",
      timeout: "5s",
      retries: 3,
    },
    logging: DEFAULT_LOGGING,
    networks: ["internal"],
  };
}
