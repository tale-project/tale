// Logical volume names used in dev compose. Kept as an explicit list so
// start.ts can pre-create externally-scoped volumes before `docker compose up`
// and the compose file can reference them as `external: true`.
export const DEV_VOLUME_NAMES = [
  'db-data',
  'db-backup',
  // Legacy: pre-0.3.0 deployments split platform and convex data; today
  // everything lives in `convex-data`. The volume is retained as an
  // unused stub so the detect() probe in start.ts can identify pre-0.3.0
  // deployments and produce a coherent diff. Operators can delete it
  // by hand once they're past the upgrade window. Do not remove this
  // entry without coordinating with that detect() heuristic.
  'platform-data',
  'convex-data',
  // The BLOB store's data. Separate from the config store on purpose:
  // config is small, text and diffable; blobs are large and opaque.
  'object-store-data',
  'caddy-data',
  'caddy-config',
  'llm-gateway-data',
] as const;

// All volumes that must exist before any `docker compose up` in production.
// Every volume declared as `external: true` in the stateful or color compose
// must appear here so `ensureVolumes` pre-creates it.
export const REQUIRED_VOLUMES = [
  // See DEV_VOLUME_NAMES for the `platform-data` rationale.
  'platform-data',
  'convex-data',
  'caddy-data',
  'caddy-config',
  'db-data',
  'db-backup',
  'object-store-data',
  'llm-gateway-data',
] as const;

/**
 * Where the backend tier reaches the BUNDLED blob store (`object-store`, the
 * MinIO service on `object-store-data`). The backend seeds the deployment
 * default `default/object-storage/connection.json` against this address at
 * boot, so a default connection that still points here means the blobs live
 * on the local volume — the test the backup uses to decide whether to
 * snapshot it, and the same comparison the backend's own bootstrap makes to
 * tell the bundled store from an operator-repointed one.
 */
export const BUNDLED_OBJECT_STORE_ENDPOINT = 'http://object-store:9000';

// Enables containers to reach host services (e.g. Ollama on localhost:11434)
// via `host.docker.internal`. `host-gateway` requires Docker 20.10+ (project
// already requires 24.0+). Safe on Docker Desktop where host.docker.internal
// is built-in.
export const EXTRA_HOSTS = ['host.docker.internal:host-gateway'];
