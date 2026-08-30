import { getProjectId } from '../../../utils/load-env';
import type { ComposeService, ServiceConfig } from '../types';
import { DEFAULT_LOGGING } from '../types';

/**
 * The deployment's BLOB store.
 *
 * S3-compatible storage is the only blob backend — Convex `_storage` retired
 * with the runtime — so a deployment without one refuses every upload with
 * `OBJECT_STORE_UNCONFIGURED`. The backend seeds the deployment-default
 * connection against this service at boot
 * (`backend/domains/object_storage/bootstrap.ts`); an org that brings its own
 * bucket is resolved BEFORE the default and is unaffected.
 *
 * Internal-only, deliberately: blobs reach the browser through presigned URLs
 * the backend signs and the proxy forwards, so the store itself is never
 * published. Keep in lockstep with the canonical `compose.yml` service —
 * compose-parity.test.ts asserts they agree.
 */
export function createObjectStorageService(
  _config: ServiceConfig,
): ComposeService {
  return {
    image: 'minio/minio:RELEASE.2025-04-22T22-12-26Z',
    container_name: `${getProjectId()}-object-store`,
    // Let in-flight multipart writes finish before SIGKILL.
    stop_grace_period: '30s',
    command: "server /data --address ':9000' --console-address ':9001'",
    environment: {
      MINIO_ROOT_USER: '${OBJECT_STORE_ACCESS_KEY:-tale}',
      MINIO_ROOT_PASSWORD:
        '${OBJECT_STORE_SECRET_KEY:?OBJECT_STORE_SECRET_KEY is required}',
      MINIO_BROWSER: 'off',
    },
    env_file: ['.env'],
    volumes: ['object-store-data:/data'],
    restart: 'unless-stopped',
    healthcheck: {
      test: ['CMD-SHELL', 'mc ready local || exit 1'],
      interval: '10s',
      timeout: '3s',
      retries: 5,
      start_period: '20s',
    },
    logging: DEFAULT_LOGGING,
    networks: { internal: { aliases: ['object-store'] } },
  };
}
