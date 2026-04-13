import { stringify } from 'yaml';

import { getProjectId } from '../../../utils/load-env';
import { createConvexService } from '../services/create-convex-service';
import { createCrawlerService } from '../services/create-crawler-service';
import { createDbService } from '../services/create-db-service';
import { createPlatformService } from '../services/create-platform-service';
import { createProxyService } from '../services/create-proxy-service';
import { createRagService } from '../services/create-rag-service';
import type { ComposeConfig, ServiceConfig } from '../types';
import { DEV_VOLUME_NAMES } from './constants';

const DEV_COLOR = 'blue' as const;

interface DevComposeOptions {
  fresh?: boolean;
}

export function generateDevCompose(
  config: ServiceConfig,
  hostAlias: string,
  port: number,
  options: DevComposeOptions = {},
): string {
  // Convex service owns the /app/data volume in Phase 2.
  const convex = createConvexService(config, DEV_COLOR);
  convex.container_name = `${getProjectId()}-convex`;
  convex.volumes = [
    'convex-data:/app/data',
    // Dev overrides: live bind-mount examples/ subfolders so edits on the host
    // are visible to the Convex actions that read them.
    './agents:/app/data/agents',
    './workflows:/app/data/workflows',
    './integrations:/app/data/integrations',
    './branding:/app/data/branding',
    './providers:/app/data/providers',
    'caddy-data:/caddy-data:ro',
  ];
  convex.depends_on = { db: { condition: 'service_healthy' } };
  if (options.fresh) {
    convex.environment = { ...convex.environment, FORCE_SEED: 'true' };
  }

  // Platform becomes a thin client — mounts convex-data read-only so
  // server.ts can watch config files + serve branding images.
  const platform = createPlatformService(config, DEV_COLOR);
  platform.container_name = `${getProjectId()}-platform`;
  platform.volumes = ['convex-data:/app/data:ro'];
  platform.environment = {
    TALE_CONFIG_DIR: '/app/data',
    AGENTS_DIR: '/app/data/agents',
    WORKFLOWS_DIR: '/app/data/workflows',
    INTEGRATIONS_DIR: '/app/data/integrations',
    PROVIDERS_DIR: '/app/data/providers',
    CONVEX_URL: 'http://convex:3210',
  };
  platform.depends_on = {
    db: { condition: 'service_healthy' },
    convex: { condition: 'service_healthy' },
  };

  const rag = createRagService(config, DEV_COLOR);
  rag.container_name = `${getProjectId()}-rag`;
  rag.depends_on = { db: { condition: 'service_healthy' } };
  rag.volumes = [
    'rag-data:/app/data',
    './providers:/app/platform-config/providers:ro',
  ];

  const crawler = createCrawlerService(config, DEV_COLOR);
  crawler.container_name = `${getProjectId()}-crawler`;
  crawler.volumes = [
    'crawler-data:/app/data',
    './providers:/app/platform-config/providers:ro',
  ];

  const proxy = createProxyService(config, hostAlias);
  proxy.ports = [`${port}:443`];

  // Scope dev volumes/networks explicitly via `external: true` + `name:`.
  // Dev volumes live under the `${projectId}-dev_` prefix (matching the
  // `-p ${projectId}-dev` passed to docker compose). They are pre-created by
  // `ensureVolumes` / `ensureNetwork` in start.ts so the compose-level
  // reference is valid even if someone runs `docker compose` by hand.
  const devPrefix = `${getProjectId()}-dev_`;
  const volumes: Record<string, { external: true; name: string }> = {};
  for (const name of DEV_VOLUME_NAMES) {
    volumes[name] = { external: true, name: `${devPrefix}${name}` };
  }

  const compose: ComposeConfig = {
    services: {
      db: createDbService(config),
      proxy,
      convex,
      platform,
      rag,
      crawler,
    },
    volumes,
    networks: {
      internal: {
        external: true,
        name: `${devPrefix}internal`,
      },
    },
  };

  return stringify(compose);
}
