import { getProjectId } from '../../../utils/load-env';
import type { ComposeService, ServiceConfig } from '../types';
import { DEFAULT_LOGGING, imagePlatform, imageRef } from '../types';
import { goMemory, memoryReservation } from './memory-env';
import { objectStoreLabels } from './traefik-labels';

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
 *
 * The server is versitygw (tale-project/tale#4942): an S3 gateway over a
 * directory, which holds about a tenth of the memory MinIO does at rest and
 * is built for arm64 too. A deployment whose blobs are still in MinIO's
 * volume gets MinIO, as it always ran it: the two keep their files in
 * formats neither reads of the other, so which one starts is read from the
 * deployment's volumes (`docker/resolve-object-store.ts`), and both answer
 * as `object-store` on port 9000.
 */
export function createObjectStorageService(
  config: ServiceConfig,
): ComposeService {
  return config.objectStore === 'minio'
    ? minioService(config)
    : versitygwService(config);
}

function versitygwService(config: ServiceConfig): ComposeService {
  const memory = goMemory('object-store');
  return {
    image: imageRef(config, 'object-store'),
    container_name: `${getProjectId()}-object-store`,
    labels: objectStoreLabels(),
    // Let a write in flight reach the disk before SIGKILL.
    stop_grace_period: '30s',
    // `--health`: a path the healthcheck asks, and one no bucket can be
    // named (an underscore is in no bucket name). `--quiet`: no line per
    // request, each of which would name an object. `--fsync`: an object is
    // on the disk before its upload is answered; without it a write the
    // backend recorded can be lost with the power.
    command: '--port :9000 --health /_health --quiet posix --fsync /data',
    environment: {
      ROOT_ACCESS_KEY: '${OBJECT_STORE_ACCESS_KEY:-tale}',
      ROOT_SECRET_KEY:
        '${OBJECT_STORE_SECRET_KEY:?OBJECT_STORE_SECRET_KEY is required}',
      // The region a request is signed for, which the backend takes from
      // the same setting.
      VGW_REGION: '${OBJECT_STORE_REGION:-us-east-1}',
      // versitygw's heap held near the store's share of the host's memory
      // (memory-env.ts).
      ...memory.environment,
    },
    // The store's share of the host's memory: spared by reclaim while
    // sandbox sessions press on host memory, where the engine runs cgroup
    // v2, and a limit four times as large as a backstop against a runaway.
    // Mirrored in compose.yml.
    ...memoryReservation('object-store', config),
    ...memory.limit,
    // No `env_file`: the edge forwards the internet's requests for presigned
    // URLs to this service, and it gets no secret of the deployment but its
    // own key.
    //
    // An object is a file under its bucket's directory, and what S3 says of
    // it (content type, ETag) is in the file's extended attributes: whatever
    // copies this volume has to keep them (`backup/constants.ts`).
    volumes: ['blob-data:/data'],
    restart: 'unless-stopped',
    healthcheck: {
      // The image's busybox. GET, which is all the health path answers.
      test: [
        'CMD',
        'wget',
        '-q',
        '-O',
        '/dev/null',
        'http://127.0.0.1:9000/_health',
      ],
      interval: '10s',
      timeout: '3s',
      retries: 5,
      start_period: '10s',
    },
    logging: DEFAULT_LOGGING,
    // It needs no privilege: it serves a port above 1024 from files it owns.
    // With every capability gone from its bounding set there is none a
    // setuid program could bring back, so it carries no `security_opt`,
    // which the Incus runtime takes for no instance.
    cap_drop: ['ALL'],
    networks: { internal: { aliases: ['object-store'] } },
  };
}

/**
 * MinIO, as every deployment ran it before versitygw. It reserves the store's
 * share like versitygw, and gets neither GOMEMLIMIT nor a memory limit
 * derived from it: MinIO holds about ten times the share at rest, so a heap
 * held to the share would keep its collector busy, and a limit four times the
 * share would kill it.
 */
function minioService(config: ServiceConfig): ComposeService {
  const image = imageRef(config, 'object-store');
  return {
    image,
    platform: imagePlatform(image),
    container_name: `${getProjectId()}-object-store`,
    labels: objectStoreLabels(),
    // Let in-flight multipart writes finish before SIGKILL.
    stop_grace_period: '30s',
    ...memoryReservation('object-store', config),
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
