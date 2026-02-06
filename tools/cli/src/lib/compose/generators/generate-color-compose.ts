import { stringify } from "yaml";
import { PROJECT_NAME } from "../../../utils/load-env";
import type { ComposeConfig, DeploymentColor, ServiceConfig } from "../types";
import { createCrawlerService } from "../services/create-crawler-service";
import { createPlatformService } from "../services/create-platform-service";
import { createRagService } from "../services/create-rag-service";
import { createOperatorService } from "../services/create-operator-service";

export function generateColorCompose(
  config: ServiceConfig,
  color: DeploymentColor
): string {
  const compose: ComposeConfig = {
    services: {
      [`platform-${color}`]: createPlatformService(config, color),
      [`rag-${color}`]: createRagService(config, color),
      [`crawler-${color}`]: createCrawlerService(config, color),
      [`operator-${color}`]: createOperatorService(config, color),
    },
    volumes: {
      "platform-convex-data": {
        external: true,
        name: `${PROJECT_NAME}_platform-convex-data`,
      },
      "caddy-data": {
        external: true,
        name: `${PROJECT_NAME}_caddy-data`,
      },
      "rag-data": {
        external: true,
        name: `${PROJECT_NAME}_rag-data`,
      },
    },
    networks: {
      internal: {
        external: true,
        name: `${PROJECT_NAME}_internal`,
      },
    },
  };

  return stringify(compose);
}
