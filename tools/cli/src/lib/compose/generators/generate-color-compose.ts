import { stringify } from 'yaml';

import { getProjectId } from '../../../utils/load-env';
import { createPlatformService } from '../services/create-platform-service';
import type { ComposeConfig, DeploymentColor, ServiceConfig } from '../types';

export function generateColorCompose(
  config: ServiceConfig,
  color: DeploymentColor,
): string {
  const compose: ComposeConfig = {
    services: {
      [`platform-${color}`]: createPlatformService(config, color),
    },
    volumes: {
      // platform mounts convex-data read-only
      'convex-data': {
        external: true,
        name: `${getProjectId()}_convex-data`,
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
