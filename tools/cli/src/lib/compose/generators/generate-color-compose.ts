import { stringify } from 'yaml';

import { getProjectId } from '../../../utils/load-env';
import {
  createBackendApiService,
  createBackendWorkerService,
} from '../services/create-backend-services';
import { createPlatformService } from '../services/create-platform-service';
import type { ComposeConfig, DeploymentColor, ServiceConfig } from '../types';

/**
 * One deployment COLOUR: the whole stateless application tier at a single
 * version — `{platform × N, backend-api × N, backend-worker × M}`.
 *
 * The compose PROJECT carries the colour (`<id>-blue`), so the services
 * inside it are named plainly and none pins a `container_name`: a pinned name
 * and `docker compose --scale` are mutually exclusive, and replicas therefore
 * come out as `<id>-blue-backend-api-1`, `-2`, … The CLI never reconstructs
 * those names; it lists them by compose label.
 *
 * Nothing here declares `depends_on`. The database, the blob store and the
 * proxy live in the STATEFUL compose, which is a different compose project,
 * and compose has no cross-project dependencies — the ordering is the
 * deploy's: stateful tier healthy first, then a colour.
 */
export function generateColorCompose(
  config: ServiceConfig,
  color: DeploymentColor,
): string {
  const prefix = `${getProjectId()}_`;
  const compose: ComposeConfig = {
    services: {
      platform: createPlatformService(config, color),
      'backend-api': createBackendApiService(config, { colour: color }),
      'backend-worker': createBackendWorkerService(config, { colour: color }),
    },
    volumes: {
      // The org config store: the backend tier writes it, platform reads it.
      // Shared by BOTH colours — it is durable state, so it does not rotate.
      'config-data': {
        external: true,
        name: `${prefix}config-data`,
      },
    },
    networks: {
      internal: { external: true, name: `${prefix}internal` },
      // The api is dual-homed so a session container reaches the connectors
      // bridge and the host-call door directly. Fixed Docker-level name so
      // the spawner can `docker run --network tale-sandbox-net`.
      sandbox: { external: true, name: 'tale-sandbox-net' },
    },
  };

  return stringify(compose);
}
