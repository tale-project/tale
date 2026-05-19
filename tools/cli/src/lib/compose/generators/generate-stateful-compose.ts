import { stringify } from 'yaml';

import { getProjectId } from '../../../utils/load-env';
import { createConvexService } from '../services/create-convex-service';
import { createDbService } from '../services/create-db-service';
import { createProxyService } from '../services/create-proxy-service';
import { createSandboxEgressService } from '../services/create-sandbox-egress-service';
import { createSandboxService } from '../services/create-sandbox-service';
import type { ComposeConfig, ServiceConfig } from '../types';

interface StatefulComposeOptions {
  fresh?: boolean;
}

export function generateStatefulCompose(
  config: ServiceConfig,
  hostAlias: string,
  options: StatefulComposeOptions = {},
): string {
  const prefix = `${getProjectId()}_`;
  const convex = createConvexService(config);
  if (options.fresh) {
    convex.environment = { ...convex.environment, FORCE_SEED: 'true' };
  }

  const compose: ComposeConfig = {
    services: {
      db: createDbService(config),
      proxy: createProxyService(config, hostAlias),
      convex,
      'sandbox-egress': createSandboxEgressService(config),
      sandbox: createSandboxService(config),
    },
    volumes: {
      'db-data': { external: true, name: `${prefix}db-data` },
      'db-backup': { external: true, name: `${prefix}db-backup` },
      'caddy-data': { external: true, name: `${prefix}caddy-data` },
      'caddy-config': { external: true, name: `${prefix}caddy-config` },
      'convex-data': { external: true, name: `${prefix}convex-data` },
    },
    networks: {
      internal: { external: true, name: `${prefix}internal` },
      // Sandbox bridge is created fresh per deployment (internal-only, IPv6
      // disabled). The Docker-level name is pinned to tale-sandbox-net so
      // the spawner can `docker run --network tale-sandbox-net` without
      // discovering compose's prefixed default name.
      sandbox: { external: true, name: 'tale-sandbox-net' },
    },
  };

  return stringify(compose);
}
