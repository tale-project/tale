import { stringify } from 'yaml';

import type { ComposeConfig, DeploymentColor, ServiceConfig } from '../types';

import { createCrawlerService } from '../services/create-crawler-service';
import { createDbService } from '../services/create-db-service';
import { createGraphDbService } from '../services/create-graph-db-service';
import { createOperatorService } from '../services/create-operator-service';
import { createPlatformService } from '../services/create-platform-service';
import { createProxyService } from '../services/create-proxy-service';
import { createRagService } from '../services/create-rag-service';
import { NETWORKS, VOLUMES } from './constants';

export function generateFullCompose(
  config: ServiceConfig,
  color: DeploymentColor,
  hostAlias: string,
): string {
  const compose: ComposeConfig = {
    services: {
      db: createDbService(config),
      'graph-db': createGraphDbService(config),
      proxy: createProxyService(config, hostAlias),
      [`platform-${color}`]: createPlatformService(config, color),
      [`rag-${color}`]: createRagService(config, color),
      [`crawler-${color}`]: createCrawlerService(config, color),
      [`operator-${color}`]: createOperatorService(config, color),
    },
    volumes: VOLUMES,
    networks: NETWORKS,
  };

  return stringify(compose);
}
