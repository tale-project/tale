import { stringify } from 'yaml';

import { getProjectId } from '../../../utils/load-env';
import { createCrawlerService } from '../services/create-crawler-service';
import { createPlatformService } from '../services/create-platform-service';
import { createRagService } from '../services/create-rag-service';
import type { ComposeConfig, DeploymentColor, ServiceConfig } from '../types';

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
        name: `${getProjectId()}_platform-data`,
      },
      'caddy-data': {
        external: true,
        name: `${getProjectId()}_caddy-data`,
      },
      'rag-data': {
        external: true,
        name: `${getProjectId()}_rag-data`,
      },
      'crawler-data': {
        external: true,
        name: `${getProjectId()}_crawler-data`,
      },
    },
    networks: {
      internal: {
        external: true,
        name: `${getProjectId()}_internal`,
      },
    },
  };

  return stringify(compose);
}
