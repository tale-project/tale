// Logical volume names used in dev compose. Kept as an explicit list so
// start.ts can pre-create externally-scoped volumes before `docker compose up`
// and the compose file can reference them as `external: true`.
export const DEV_VOLUME_NAMES = [
  'db-data',
  'db-backup',
  'rag-data',
  // Retained for legacy migration (used by `tale migrate split-convex` to
  // locate pre-split data). Not mounted by any container after Phase 2.
  'platform-data',
  'convex-data',
  'caddy-data',
  'caddy-config',
  'crawler-data',
] as const;

// All volumes that must exist before any `docker compose up` in production.
// Every volume declared as `external: true` in the stateful or color compose
// must appear here so `ensureVolumes` pre-creates it.
export const REQUIRED_VOLUMES = [
  // platform-data is kept for upgrade scenarios where split-convex migrates
  // its contents into convex-data; on fresh installs it is an unused empty
  // volume. Removing it would break detect() for pre-0.3.0 deployments.
  'platform-data',
  'convex-data',
  'caddy-data',
  'caddy-config',
  'db-data',
  'db-backup',
  'rag-data',
  'crawler-data',
] as const;

// Enables containers to reach host services (e.g. Ollama on localhost:11434)
// via `host.docker.internal`. `host-gateway` requires Docker 20.10+ (project
// already requires 24.0+). Safe on Docker Desktop where host.docker.internal
// is built-in.
export const EXTRA_HOSTS = ['host.docker.internal:host-gateway'];
