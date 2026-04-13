import { stringify } from 'yaml';

import { getProjectId } from '../../../utils/load-env';
import { createConvexService } from '../services/create-convex-service';
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
  // Convex is a singleton (like a Postgres primary); both platform colors
  // point at the same convex instance. We emit a single `convex` service
  // (no color suffix) the first time — if the container already exists the
  // compose file is harmless.
  const convex = createConvexService(config, color);
  if (options.fresh) {
    platform.environment = {
      ...platform.environment,
      FORCE_SEED: 'true',
    };
    convex.environment = {
      ...convex.environment,
      FORCE_SEED: 'true',
    };
  }

  const compose: ComposeConfig = {
    services: {
      convex,
      [`platform-${color}`]: platform,
      [`rag-${color}`]: createRagService(config, color),
      [`crawler-${color}`]: createCrawlerService(config, color),
    },
    volumes: {
      // Legacy platform-data volume — kept declared so `tale migrate
      // split-convex` can still find it during upgrades; containers do not
      // mount it any more.
      'platform-data': {
        external: true,
        name: `${getProjectId()}_platform-data`,
      },
      'convex-data': {
        external: true,
        name: `${getProjectId()}_convex-data`,
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
