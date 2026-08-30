import { stringify } from 'yaml';

import { getProjectId } from '../../../utils/load-env';
import {
  createBackendApiService,
  createBackendWorkerService,
} from '../services/create-backend-services';
import { createBgutilProviderService } from '../services/create-bgutil-provider-service';
import { createControllerService } from '../services/create-controller-service';
import { createDbService } from '../services/create-db-service';
import { createObjectStorageService } from '../services/create-object-storage-service';
import { createProxyService } from '../services/create-proxy-service';
import { createSandboxEgressService } from '../services/create-sandbox-egress-service';
import { createSandboxLlmGatewayService } from '../services/create-sandbox-llm-gateway-service';
import { createSandboxService } from '../services/create-sandbox-service';
import type { ComposeConfig, ServiceConfig } from '../types';

export function generateStatefulCompose(
  config: ServiceConfig,
  hostAlias: string,
): string {
  const prefix = `${getProjectId()}_`;
  const services: ComposeConfig['services'] = {
    db: createDbService(config),
    // The blob store: S3 is the only blob backend, so a deployment without
    // one cannot accept a single upload.
    'object-store': createObjectStorageService(config),
    proxy: createProxyService(config, hostAlias),
    'backend-api': createBackendApiService(config),
    'backend-worker': createBackendWorkerService(config),
    'sandbox-llm-gateway': createSandboxLlmGatewayService(config),
    'sandbox-egress': createSandboxEgressService(config),
    sandbox: createSandboxService(config),
    // Third-party sidecar; deploy.ts brings it up best-effort after core
    // services (not in the always-roll tier — see the service comment).
    'bgutil-provider': createBgutilProviderService(config),
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
      'object-store-data': {
        external: true,
        name: `${prefix}object-store-data`,
      },
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
