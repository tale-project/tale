export const VOLUMES = {
  'db-data': { driver: 'local' },
  'db-backup': { driver: 'local' },
  'rag-data': { driver: 'local' },
  'platform-data': { driver: 'local' },
  'caddy-data': { driver: 'local' },
  'caddy-config': { driver: 'local' },
  'crawler-data': { driver: 'local' },
};

export const NETWORKS = {
  internal: { driver: 'bridge' },
};

// Enables containers to reach host services (e.g. Ollama on localhost:11434)
// via `host.docker.internal`. `host-gateway` requires Docker 20.10+ (project
// already requires 24.0+). Safe on Docker Desktop where host.docker.internal
// is built-in.
export const EXTRA_HOSTS = ['host.docker.internal:host-gateway'];
