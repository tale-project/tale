// Logical volume names used in dev compose. Kept as an explicit list so
// start.ts can pre-create externally-scoped volumes before `docker compose up`
// and the compose file can reference them as `external: true`.
export const DEV_VOLUME_NAMES = [
  'db-data',
  'db-backup',
  // Retired names, kept as unused stubs so teardown (`tale reset --all`,
  // `tale uninstall --purge`) and upgrade diagnostics still see them, and so
  // an operator past the upgrade window can delete them deliberately rather
  // than find them orphaned:
  //   platform-data — pre-0.3.0 split of platform and convex data.
  //   convex-data   — the org config store before it became `config-data`;
  //                   `migrate-config-volume.ts` copies it across on the
  //                   first bring-up and never deletes it.
  'platform-data',
  'convex-data',
  // The org CONFIG store: every `<org>/<domain>/*` file the backend tier
  // writes and the web tier reads.
  'config-data',
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
  // See DEV_VOLUME_NAMES for the retired-stub rationale.
  'platform-data',
  'convex-data',
  'config-data',
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
