import type { ComposeService, ServiceConfig } from "../types";
import { DEFAULT_LOGGING } from "../types";

export function createProxyService(
  config: ServiceConfig,
  hostAlias: string
): ComposeService {
  return {
    image: `${config.registry}/tale-proxy:${config.version}`,
    container_name: "tale-proxy",
    ports: ["80:80", "443:443"],
    volumes: ["caddy-data:/data", "caddy-config:/config"],
    env_file: [".env"],
    restart: "unless-stopped",
    healthcheck: {
      test: [
        "CMD",
        "wget",
        "--no-verbose",
        "--tries=1",
        "--spider",
        "http://127.0.0.1:80/health",
      ],
      interval: "30s",
      timeout: "10s",
      retries: 3,
      start_period: "10s",
    },
    logging: DEFAULT_LOGGING,
    networks: {
      internal: {
        aliases: [hostAlias],
      },
    },
  };
}
