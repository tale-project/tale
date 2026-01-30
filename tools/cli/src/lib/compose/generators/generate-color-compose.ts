import { stringify } from "yaml";
import type { ComposeConfig, DeploymentColor, ServiceConfig } from "../types";
import { createCrawlerService } from "../services/create-crawler-service";
import { createPlatformService } from "../services/create-platform-service";
import { createRagService } from "../services/create-rag-service";
import { createSearchService } from "../services/create-search-service";

export function generateColorCompose(
  config: ServiceConfig,
  color: DeploymentColor
): string {
  const compose: ComposeConfig = {
    services: {
      [`platform-${color}`]: createPlatformService(config, color),
      [`rag-${color}`]: createRagService(config, color),
      [`crawler-${color}`]: createCrawlerService(config, color),
      [`search-${color}`]: createSearchService(config, color),
    },
    volumes: {
      "platform-convex-data": {
        external: true,
        name: `${config.projectName}_platform-convex-data`,
      },
      "caddy-data": {
        external: true,
        name: `${config.projectName}_caddy-data`,
      },
      "rag-data": {
        external: true,
        name: `${config.projectName}_rag-data`,
      },
    },
    networks: {
      internal: {
        external: true,
        name: `${config.projectName}_internal`,
      },
    },
  };

  return stringify(compose);
}
