import { stringify } from 'yaml';

import { getProjectId } from '../../../utils/load-env';
import { createControllerService } from '../services/create-controller-service';
import { createConvexService } from '../services/create-convex-service';
import { createDbService } from '../services/create-db-service';
import { createLlmGatewayService } from '../services/create-llm-gateway-service';
import { createProxyService } from '../services/create-proxy-service';
import { createSandboxEgressService } from '../services/create-sandbox-egress-service';
import { createSandboxService } from '../services/create-sandbox-service';
import type { ComposeConfig, ServiceConfig } from '../types';

export function generateStatefulCompose(
  config: ServiceConfig,
  hostAlias: string,
): string {
  const prefix = `${getProjectId()}_`;
  const convex = createConvexService(config);

  const services: ComposeConfig['services'] = {
    db: createDbService(config),
    proxy: createProxyService(config, hostAlias),
    convex,
    'llm-gateway': createLlmGatewayService(config),
    'sandbox-egress': createSandboxEgressService(config),
    sandbox: createSandboxService(config),
  };
  // Opt-in: emit the privileged restart sidecar only when a shared HMAC token
  // is configured (it exits without one anyway). Operators who want one-click
  // "Apply & restart" set CONTROLLER_TOKEN (+ CONTROLLER_URL) in .env.
  if (process.env.CONTROLLER_TOKEN) {
    services.controller = createControllerService(config);
  }

  const compose: ComposeConfig = {
    services,
    volumes: {
      'db-data': { external: true, name: `${prefix}db-data` },
      'db-backup': { external: true, name: `${prefix}db-backup` },
      'caddy-data': { external: true, name: `${prefix}caddy-data` },
      'caddy-config': { external: true, name: `${prefix}caddy-config` },
      'convex-data': { external: true, name: `${prefix}convex-data` },
      'llm-gateway-data': {
        external: true,
        name: `${prefix}llm-gateway-data`,
      },
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
