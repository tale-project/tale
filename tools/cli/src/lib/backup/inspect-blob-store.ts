import * as logger from '../../utils/logger';
import { BUNDLED_OBJECT_STORE_ENDPOINT } from '../compose/generators/constants';
import { volumeExists } from '../docker/ensure-volumes';
import { exec } from '../docker/exec';
import { BACKUP_HELPER_IMAGE, CONFIG_VOLUME } from './constants';

/**
 * Where the deployment default blob store points — the `default` config
 * tree's `object-storage/connection.json`, which the backend seeds against
 * the bundled `object-store` at boot and an operator may repoint at their
 * own S3. `unknown` covers a store that was never seeded and a config
 * volume that cannot be read; callers treat it as "capture the volume".
 */
export type BlobStoreDefault =
  | { kind: 'bundled' }
  | { kind: 'external'; endpoint: string; bucket: string }
  | { kind: 'unknown'; reason: string };

export interface BlobStoreLayout {
  default: BlobStoreDefault;
  /**
   * Organizations that bring their own bucket (`<slug>/object-storage/
   * connection.json`, resolved by the backend BEFORE the default). Their
   * blobs never touch the local volume, so no snapshot can contain them.
   */
  ownBucketOrgs: string[];
}

const DEFAULT_ORG_SLUG = 'default';

/**
 * The backend's file contract for the object-storage config domain
 * (`backend/core/object_storage/file_utils.ts`), as seen from the config
 * volume mounted at `/data`.
 */
const CONNECTION_PATH_RE =
  /^\/data\/([^/]+)\/object-storage\/connection\.json$/;

/**
 * One `<path>\t<json>` row per connection file. The JSON is pretty-printed
 * on disk, so raw newlines are dropped to keep one row per file — JSON
 * strings escape theirs, so nothing is lost. `true` keeps the exit code 0
 * when no org has a connection file (the glob then matches nothing).
 */
const INSPECT_SCRIPT = [
  'for f in /data/*/object-storage/connection.json; do',
  '[ -f "$f" ] || continue;',
  `printf '%s\\t' "$f"; tr -d '\\n' < "$f"; echo;`,
  'done; true',
].join(' ');

interface ConnectionSummary {
  /** Absent for AWS S3 proper (the schema leaves the endpoint optional). */
  endpoint?: string;
  bucket: string;
}

function parseConnection(raw: string): ConnectionSummary | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { endpoint, bucket } = value as Record<string, unknown>;
  if (typeof bucket !== 'string' || bucket.length === 0) return null;
  if (endpoint !== undefined && typeof endpoint !== 'string') return null;
  return endpoint === undefined ? { bucket } : { endpoint, bucket };
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, '');
}

/**
 * Learn where this deployment's blobs live by reading the object-storage
 * connection files from the config volume — the same files, with the same
 * bundled-vs-repointed test (endpoint equality), the backend resolves them
 * with. Never throws: anything short of a readable default connection is
 * reported as `unknown`, and the backup then captures the blob volume
 * rather than risk skipping data.
 */
export async function inspectBlobStore(
  prefix: string,
): Promise<BlobStoreLayout> {
  const configVolume = `${prefix}${CONFIG_VOLUME}`;
  if (!(await volumeExists(configVolume))) {
    return {
      default: {
        kind: 'unknown',
        reason: `config volume ${configVolume} does not exist`,
      },
      ownBucketOrgs: [],
    };
  }

  const result = await exec('docker', [
    'run',
    '--rm',
    '-v',
    `${configVolume}:/data:ro`,
    BACKUP_HELPER_IMAGE,
    'sh',
    '-c',
    INSPECT_SCRIPT,
  ]);
  if (!result.success) {
    const detail = result.stderr || result.stdout;
    logger.warn(
      `Could not inspect the object-storage config in ${configVolume} (${detail}) — capturing the blob volume to be safe.`,
    );
    return {
      default: { kind: 'unknown', reason: `inspection failed: ${detail}` },
      ownBucketOrgs: [],
    };
  }

  let defaultStore: BlobStoreDefault = {
    kind: 'unknown',
    reason: 'no default/object-storage/connection.json (store not seeded yet)',
  };
  const ownBucketOrgs: string[] = [];
  for (const line of result.stdout.split('\n')) {
    const row = line.trim();
    if (!row) continue;
    const tab = row.indexOf('\t');
    if (tab === -1) continue;
    const match = CONNECTION_PATH_RE.exec(row.slice(0, tab));
    if (!match) continue;
    const slug = match[1] ?? '';

    const connection = parseConnection(row.slice(tab + 1));
    if (!connection) {
      logger.warn(
        `Skipping unreadable object-storage connection file for "${slug}" — the backend fails closed on it too.`,
      );
      if (slug === DEFAULT_ORG_SLUG) {
        defaultStore = {
          kind: 'unknown',
          reason: 'default/object-storage/connection.json is unreadable',
        };
      }
      continue;
    }

    if (slug !== DEFAULT_ORG_SLUG) {
      ownBucketOrgs.push(slug);
      continue;
    }
    defaultStore =
      connection.endpoint !== undefined &&
      normalizeEndpoint(connection.endpoint) === BUNDLED_OBJECT_STORE_ENDPOINT
        ? { kind: 'bundled' }
        : {
            kind: 'external',
            endpoint: connection.endpoint ?? 'AWS S3',
            bucket: connection.bucket,
          };
  }
  ownBucketOrgs.sort();

  return { default: defaultStore, ownBucketOrgs };
}
