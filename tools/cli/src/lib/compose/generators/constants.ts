// Logical volume names used in dev compose. Kept as an explicit list so
// start.ts can pre-create externally-scoped volumes before `docker compose up`
// and the compose file can reference them as `external: true`.
export const DEV_VOLUME_NAMES = [
  'db-data',
  'db-backup',
  'rag-data',
  'platform-data',
  'caddy-data',
  'caddy-config',
  'crawler-data',
] as const;

// Enables containers to reach host services (e.g. Ollama on localhost:11434)
// via `host.docker.internal`. `host-gateway` requires Docker 20.10+ (project
// already requires 24.0+). Safe on Docker Desktop where host.docker.internal
// is built-in.
export const EXTRA_HOSTS = ['host.docker.internal:host-gateway'];
