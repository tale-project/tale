import { stringify } from 'yaml';

import type { ComposeConfig, ServiceConfig } from '../types';

import { PROJECT_NAME } from '../../../utils/load-env';
import { createCrawlerService } from '../services/create-crawler-service';
import { createDbService } from '../services/create-db-service';
import { createPlatformService } from '../services/create-platform-service';
import { createProxyService } from '../services/create-proxy-service';
import { createRagService } from '../services/create-rag-service';
import { NETWORKS, VOLUMES } from './constants';

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
  const platform = createPlatformService(config, DEV_COLOR);
  platform.container_name = `${PROJECT_NAME}-platform`;
  platform.volumes = [
    'platform-data:/app/data',
    './agents:/app/data/agents',
    './workflows:/app/data/workflows',
    './integrations:/app/data/integrations',
    './branding:/app/data/branding',
    './providers:/app/data/providers',
    'caddy-data:/caddy-data:ro',
  ];
  platform.environment = {
    TALE_CONFIG_DIR: '/app/data',
    AGENTS_DIR: '/app/data/agents',
    WORKFLOWS_DIR: '/app/data/workflows',
    INTEGRATIONS_DIR: '/app/data/integrations',
    ...(options.fresh ? { FORCE_SEED: 'true' } : {}),
  };
  platform.depends_on = { db: { condition: 'service_healthy' } };

  const rag = createRagService(config, DEV_COLOR);
  rag.container_name = `${PROJECT_NAME}-rag`;
  rag.depends_on = { db: { condition: 'service_healthy' } };
  rag.volumes = [
    'rag-data:/app/data',
    './providers:/app/platform-config/providers:ro',
  ];

  const crawler = createCrawlerService(config, DEV_COLOR);
  crawler.container_name = `${PROJECT_NAME}-crawler`;
  crawler.volumes = [
    'crawler-data:/app/data',
    './providers:/app/platform-config/providers:ro',
  ];

  const proxy = createProxyService(config, hostAlias);
  proxy.ports = [`${port}:443`];

  const compose: ComposeConfig = {
    services: {
      db: createDbService(config),
      proxy,
      platform,
      rag,
      crawler,
    },
    volumes: VOLUMES,
    networks: NETWORKS,
  };

  return stringify(compose);
}
