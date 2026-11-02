import { getProjectId } from '../../../utils/load-env';
import { EXTRA_HOSTS } from '../generators/constants';
import type { ComposeService, ServiceConfig } from '../types';
import { DEFAULT_LOGGING, imageRef } from '../types';

/** The image's own probe, for either role (services/proxy/tale-proxy). */
const PROXY_HEALTHCHECK: NonNullable<ComposeService['healthcheck']> = {
  test: ['CMD', 'tale-proxy', 'health'],
  interval: '30s',
  timeout: '10s',
  retries: 3,
  start_period: '10s',
};

/**
 * The edge: Traefik, routing each request by the labels of the service that
 * serves it (traefik-labels.ts). `projects` are the Compose projects whose
 * labelled containers it routes — the stateful project and both colours, or
 * the dev project — and no other.
 */
export function createProxyService(
  config: ServiceConfig,
  hostAlias: string,
  projects: string[],
): ComposeService {
  return {
    image: imageRef(config, 'proxy'),
    container_name: `${getProjectId()}-proxy`,
    ports: ['80:80', '443:443'],
    // The ACME account and certificates, and the self-signed CA. The Caddy
    // volumes stay declared beside it, untouched, until the upgrade moves
    // them (tale-project/tale#5209).
    volumes: ['proxy-data:/data'],
    env_file: ['.env'],
    environment: { TALE_PROXY_PROJECTS: projects.join(' ') },
    restart: 'unless-stopped',
    healthcheck: PROXY_HEALTHCHECK,
    logging: DEFAULT_LOGGING,
    networks: {
      internal: {
        // Hairpin-NAT alias: lets a container resolve the public HOST to the
        // proxy. Inert for the default `localhost` (shadowed by /etc/hosts),
        // which is fine — nothing calls the public URL server-side (no SSR).
        // Does real work when HOST is a custom domain. Mirrors compose.yml.
        aliases: [hostAlias],
      },
      'docker-api': {},
    },
    extra_hosts: EXTRA_HOSTS,
  };
}

/**
 * The read-only Docker API proxy, the one way the edge reads the labels: the
 * proxy image's `docker-api` role (services/proxy/docker-api/nginx.conf). It
 * answers GET and HEAD on the version, ping, events and container list and
 * inspect endpoints, strips every container's environment from an inspect
 * answer, and refuses everything else — so the edge, which faces the
 * internet, never holds the socket itself.
 *
 * The socket is mounted read-only, and the service joins only the internal
 * `docker-api` network, which no other service but the proxy joins: no port
 * is published and nothing else on the host can call it.
 */
export function createDockerApiService(config: ServiceConfig): ComposeService {
  return {
    image: imageRef(config, 'proxy'),
    container_name: `${getProjectId()}-docker-api`,
    command: 'docker-api',
    volumes: ['/var/run/docker.sock:/var/run/docker.sock:ro'],
    restart: 'unless-stopped',
    healthcheck: PROXY_HEALTHCHECK,
    logging: DEFAULT_LOGGING,
    networks: ['docker-api'],
    security_opt: ['no-new-privileges:true'],
  };
}
