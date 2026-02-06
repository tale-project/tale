import { PROJECT_NAME } from "../../../utils/load-env";
import type { ComposeService, ServiceConfig } from "../types";
import { DEFAULT_LOGGING } from "../types";

export function createDbService(config: ServiceConfig): ComposeService {
  return {
    image: `${config.registry}/tale-db:${config.version}`,
    container_name: `${PROJECT_NAME}-db`,
    volumes: [
      "db-data:/var/lib/postgresql/data",
      "db-backup:/var/lib/postgresql/backup",
    ],
    env_file: [".env"],
    restart: "unless-stopped",
    healthcheck: {
      test: [
        "CMD-SHELL",
        "pg_isready -U ${POSTGRES_USER:-tale} -d ${POSTGRES_DB:-tale}",
      ],
      interval: "30s",
      timeout: "10s",
      retries: 3,
      start_period: "60s",
    },
    logging: DEFAULT_LOGGING,
    networks: ["internal"],
  };
}
