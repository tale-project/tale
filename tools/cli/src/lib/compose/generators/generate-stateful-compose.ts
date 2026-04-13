import { stringify } from 'yaml';

import { getProjectId } from '../../../utils/load-env';
import { createDbService } from '../services/create-db-service';
import { createProxyService } from '../services/create-proxy-service';
import type { ComposeConfig, ServiceConfig } from '../types';

export function generateStatefulCompose(
  config: ServiceConfig,
  hostAlias: string,
): string {
  const prefix = `${getProjectId()}_`;
  const compose: ComposeConfig = {
    services: {
      db: createDbService(config),
      proxy: createProxyService(config, hostAlias),
    },
    volumes: {
      'db-data': { external: true, name: `${prefix}db-data` },
      'db-backup': { external: true, name: `${prefix}db-backup` },
      'caddy-data': { external: true, name: `${prefix}caddy-data` },
      'caddy-config': { external: true, name: `${prefix}caddy-config` },
    },
    networks: {
      internal: { external: true, name: `${prefix}internal` },
    },
  };

  return stringify(compose);
}
