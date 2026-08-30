import { getProjectId } from '../../../utils/load-env';
import { EXTRA_HOSTS } from '../generators/constants';
import type { ComposeService, ServiceConfig } from '../types';
import { DEFAULT_LOGGING, imageRef } from '../types';

export function createProxyService(
  config: ServiceConfig,
  hostAlias: string,
): ComposeService {
  return {
    image: imageRef(config, 'proxy'),
    container_name: `${getProjectId()}-proxy`,
    ports: ['80:80', '443:443'],
    volumes: ['caddy-data:/data', 'caddy-config:/config'],
    env_file: ['.env'],
    restart: 'unless-stopped',
    healthcheck: {
      test: [
        'CMD',
        'wget',
        '--no-verbose',
        '--tries=1',
        '--spider',
        'http://127.0.0.1:2020/health',
      ],
      interval: '30s',
      timeout: '10s',
      retries: 3,
      start_period: '10s',
    },
    logging: DEFAULT_LOGGING,
    networks: {
      internal: {
        // Hairpin-NAT alias: lets a container resolve the public HOST to the
        // proxy. Inert for the default `localhost` (shadowed by /etc/hosts),
        // which is fine — nothing calls the public URL server-side (no SSR).
        // Does real work when HOST is a custom domain. Mirrors compose.yml.
        aliases: [hostAlias],
      },
    },
    extra_hosts: EXTRA_HOSTS,
  };
}
