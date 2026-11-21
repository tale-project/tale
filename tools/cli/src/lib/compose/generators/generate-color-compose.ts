import { stringify } from 'yaml';

import { getProjectId } from '../../../utils/load-env';
import type { RunOrigin } from '../../config/dev-origin';
import { THREE_WAY } from '../app-tier';
import {
  createBackendApiService,
  createBackendWorkerService,
} from '../services/create-backend-services';
import { createPlatformService } from '../services/create-platform-service';
import type { ComposeConfig, DeploymentColor, ServiceConfig } from '../types';
import { serveOrigin } from './serve-origin';

/**
 * One deployment COLOUR: the whole stateless application tier at a single
 * version, in the shape `config.appTier` names (app-tier.ts): `platform × N`
 * alone where one process is the whole application, `platform` and
 * `backend-worker` where the job runners scale apart, or the three services
 * `{platform × N, backend-api × N, backend-worker × M}` an image from before
 * the web tier moved needs, which is also what a caller gets that names no
 * shape.
 *
 * The compose PROJECT carries the colour (`<id>-blue`), so the services
 * inside it are named plainly and none pins a `container_name`: a pinned name
 * and `docker compose --scale` are mutually exclusive, and replicas therefore
 * come out as `<id>-blue-platform-1`, `-2`, … The CLI never reconstructs
 * those names; it lists them by compose label.
 *
 * Nothing here declares `depends_on`. The database, the blob store and the
 * proxy live in the STATEFUL compose, which is a different compose project,
 * and compose has no cross-project dependencies — the ordering is the
 * deploy's: stateful tier healthy first, then a colour.
 *
 * `origin` is the host a `tale deploy --host` run serves instead of `.env`'s.
 *
 * This returns the document as an object, which the Incus runtime compiles;
 * generateColorCompose stringifies it for Docker Compose.
 */
export function buildColorCompose(
  config: ServiceConfig,
  color: DeploymentColor,
  origin?: RunOrigin,
): ComposeConfig {
  const prefix = `${getProjectId()}_`;
  const tier = config.appTier ?? THREE_WAY;
  const build = {
    platform: () => createPlatformService(config, color),
    'backend-api': () => createBackendApiService(config, { colour: color }),
    'backend-worker': () =>
      createBackendWorkerService(config, { colour: color }),
  };
  const services: ComposeConfig['services'] = Object.fromEntries(
    tier.services.map((service) => [service, build[service]()]),
  );
  if (origin) serveOrigin(Object.values(services), origin);
  const compose: ComposeConfig = {
    services,
    volumes: {
      'static-assets': {
        external: true,
        name: `${prefix}static-assets`,
      },
      // The org config store: the backend tier writes it, platform reads it.
      // Shared by BOTH colours — it is durable state, so it does not rotate.
      'config-data': {
        external: true,
        name: `${prefix}config-data`,
      },
    },
    networks: {
      internal: { external: true, name: `${prefix}internal` },
      // The service that answers the API is dual-homed so a session container
      // reaches the connectors bridge and the host-call door directly. Fixed
      // Docker-level name so the spawner can
      // `docker run --network tale-sandbox-net`.
      sandbox: { external: true, name: 'tale-sandbox-net' },
    },
  };

  return compose;
}

/** One colour's compose document as Docker Compose reads it. */
export function generateColorCompose(
  config: ServiceConfig,
  color: DeploymentColor,
  origin?: RunOrigin,
): string {
  return stringify(buildColorCompose(config, color, origin));
}
