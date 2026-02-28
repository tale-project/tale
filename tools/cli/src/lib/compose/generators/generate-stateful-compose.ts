import { stringify } from 'yaml';

import type { ComposeConfig, ServiceConfig } from '../types';

import { createDbService } from '../services/create-db-service';
import { createProxyService } from '../services/create-proxy-service';
import { NETWORKS, VOLUMES } from './constants';

export function generateStatefulCompose(
  config: ServiceConfig,
  hostAlias: string,
): string {
  const compose: ComposeConfig = {
    services: {
      db: createDbService(config),
      proxy: createProxyService(config, hostAlias),
    },
    volumes: VOLUMES,
    networks: NETWORKS,
  };

  return stringify(compose);
}
