import { stringify } from 'yaml';

import { getProjectId } from '../../../utils/load-env';
import type { RunOrigin } from '../../config/dev-origin';
import {
  createBgutilProviderService,
  potProviderAsked,
} from '../services/create-bgutil-provider-service';
import { createDbService } from '../services/create-db-service';
import { createObjectStorageService } from '../services/create-object-storage-service';
import {
  createDockerApiService,
  createProxyService,
} from '../services/create-proxy-service';
import { createSandboxEgressService } from '../services/create-sandbox-egress-service';
import { createSandboxService } from '../services/create-sandbox-service';
import type { ComposeConfig, ServiceConfig } from '../types';
import { serveOrigin } from './serve-origin';

/**
 * The stateful compose document as an object: what Docker Compose reads once
 * stringified (generateStatefulCompose), and what the Incus runtime compiles.
 *
 * `origin` is the host a `tale deploy --host` run serves instead of `.env`'s;
 * without it the proxy reads HOST and SITE_URL from `.env`.
 */
export function buildStatefulCompose(
  config: ServiceConfig,
  hostAlias: string,
  origin?: RunOrigin,
): ComposeConfig {
  const prefix = `${getProjectId()}_`;
  const id = getProjectId();
  const proxy = createProxyService(config, hostAlias, [
    id,
    `${id}-blue`,
    `${id}-green`,
  ]);
  if (origin) serveOrigin([proxy], origin);
  const services: ComposeConfig['services'] = {
    db: createDbService(config),
    // The blob store: S3 is the only blob backend, so a deployment without
    // one cannot accept a single upload.
    'object-store': createObjectStorageService(config),
    proxy,
    'docker-api': createDockerApiService(config),
    // The application tier is NOT here: platform, backend-api and
    // backend-worker are stateless and deploy as one colour
    // (generate-color-compose.ts). What remains is what holds durable state
    // or a fixed identity — the stores, the entry point, and the sandbox
    // singleton that owns docker.sock.
    'sandbox-egress': createSandboxEgressService(config),
    sandbox: createSandboxService(config),
    // Third-party sidecar, where the deployment asked for it; deploy.ts
    // brings it up best-effort after core services (not in the always-roll
    // tier — see the service comment).
    ...(potProviderAsked()
      ? { 'bgutil-provider': createBgutilProviderService(config) }
      : {}),
  };
  const compose: ComposeConfig = {
    services,
    volumes: {
      'static-assets': { external: true, name: `${prefix}static-assets` },
      'db-data': { external: true, name: `${prefix}db-data` },
      'db-backup': { external: true, name: `${prefix}db-backup` },
      'caddy-data': { external: true, name: `${prefix}caddy-data` },
      'caddy-config': { external: true, name: `${prefix}caddy-config` },
      'proxy-data': { external: true, name: `${prefix}proxy-data` },
      'config-data': { external: true, name: `${prefix}config-data` },
      'blob-data': { external: true, name: `${prefix}blob-data` },
      'object-store-data': {
        external: true,
        name: `${prefix}object-store-data`,
      },
    },
    networks: {
      internal: { external: true, name: `${prefix}internal` },
      // Sandbox bridge is created fresh per deployment (internal-only, IPv6
      // disabled). The Docker-level name is pinned to tale-sandbox-net so
      // the spawner can `docker run --network tale-sandbox-net` without
      // discovering compose's prefixed default name.
      sandbox: { external: true, name: 'tale-sandbox-net' },
      // The Docker API proxy's own network: the edge and the API proxy
      // alone, and no route out (create-proxy-service.ts).
      'docker-api': { internal: true },
    },
  };

  return compose;
}

/** The stateful compose document as Docker Compose reads it. */
export function generateStatefulCompose(
  config: ServiceConfig,
  hostAlias: string,
  origin?: RunOrigin,
): string {
  return stringify(buildStatefulCompose(config, hostAlias, origin));
}
