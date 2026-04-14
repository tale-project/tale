import { stringify } from 'yaml';

import { getProjectId } from '../../../utils/load-env';
import { createCrawlerService } from '../services/create-crawler-service';
import { createPlatformService } from '../services/create-platform-service';
import { createRagService } from '../services/create-rag-service';
import type { ComposeConfig, DeploymentColor, ServiceConfig } from '../types';

export function generateColorCompose(
  config: ServiceConfig,
  color: DeploymentColor,
): string {
  const compose: ComposeConfig = {
    services: {
      [`platform-${color}`]: createPlatformService(config, color),
      [`rag-${color}`]: createRagService(config, color),
      [`crawler-${color}`]: createCrawlerService(config, color),
    },
    volumes: {
      // platform, rag, and crawler mount convex-data read-only
      'convex-data': {
        external: true,
        name: `${getProjectId()}_convex-data`,
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
