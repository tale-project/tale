import { stringify } from 'yaml';

import type { ComposeConfig, DeploymentColor, ServiceConfig } from '../types';

import { PROJECT_NAME } from '../../../utils/load-env';
import { createCrawlerService } from '../services/create-crawler-service';
import { createPlatformService } from '../services/create-platform-service';
import { createRagService } from '../services/create-rag-service';

interface ColorComposeOptions {
  fresh?: boolean;
}

export function generateColorCompose(
  config: ServiceConfig,
  color: DeploymentColor,
  options: ColorComposeOptions = {},
): string {
  const platform = createPlatformService(config, color);
  if (options.fresh) {
    platform.environment = {
      ...platform.environment,
      FORCE_SEED: 'true',
    };
  }

  const compose: ComposeConfig = {
    services: {
      [`platform-${color}`]: platform,
      [`rag-${color}`]: createRagService(config, color),
      [`crawler-${color}`]: createCrawlerService(config, color),
    },
    volumes: {
      'platform-data': {
        external: true,
        name: `${PROJECT_NAME}_platform-data`,
      },
      'caddy-data': {
        external: true,
        name: `${PROJECT_NAME}_caddy-data`,
      },
      'rag-data': {
        external: true,
        name: `${PROJECT_NAME}_rag-data`,
      },
      'crawler-data': {
        external: true,
        name: `${PROJECT_NAME}_crawler-data`,
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
