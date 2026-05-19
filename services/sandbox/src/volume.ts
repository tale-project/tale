// Per-org cache volume helpers + post-run output harvest.
//
// Per-org pip/npm caches are persistent named volumes scoped to organizationId
// (R2.3 — closes the cross-tenant wheel-cache poison vector). The runtime
// container itself uses a `--tmpfs /workspace` for the workspace, so there is
// no per-call workspace volume to manage.

import { runDocker } from './spawn_util.ts';
import type { SpawnerConfig } from './types.ts';

const ORG_SLUG_RE = /^[a-zA-Z0-9_-]{1,128}$/;

function orgSlug(organizationId: string): string {
  if (!ORG_SLUG_RE.test(organizationId)) {
    throw new Error(
      `volume: refusing unsafe organizationId for volume name: ${JSON.stringify(organizationId)}`,
    );
  }
  return organizationId;
}

export function pipCacheVolumeName(
  cfg: SpawnerConfig,
  organizationId: string,
): string {
  return `${cfg.cacheVolumePrefix.pip}-${orgSlug(organizationId)}`;
}

export function npmCacheVolumeName(
  cfg: SpawnerConfig,
  organizationId: string,
): string {
  return `${cfg.cacheVolumePrefix.npm}-${orgSlug(organizationId)}`;
}

/**
 * Lazy idempotent create. New volumes are root-owned by default and the
 * runtime container runs as nobody (65534), so on first creation we also
 * spin up a transient busybox to chown the volume's root to 65534:65534.
 * Subsequent calls are no-ops (we detect via `docker volume inspect`).
 */
export async function ensureCacheVolume(name: string): Promise<void> {
  const inspect = await runDocker(['volume', 'inspect', name]);
  if (inspect.exitCode === 0) return; // already exists, already chowned

  const create = await runDocker([
    'volume',
    'create',
    '--label',
    'tale.sandbox-cache=1',
    name,
  ]);
  if (create.exitCode !== 0) {
    throw new Error(
      `volume: failed to create cache volume ${name}: ${create.stderr.trim() || create.stdout.trim()}`,
    );
  }

  // One-shot chown so the unprivileged runtime user can write to the cache.
  const chown = await runDocker([
    'run',
    '--rm',
    '--user',
    '0:0',
    '--label',
    'tale.sandbox-staging=1',
    '--mount',
    `type=volume,src=${name},dst=/cache`,
    'busybox:1.36',
    'chown',
    '65534:65534',
    '/cache',
  ]);
  if (chown.exitCode !== 0) {
    throw new Error(
      `volume: failed to chown cache volume ${name}: ${chown.stderr.trim()}`,
    );
  }
}

export async function removeVolume(name: string): Promise<void> {
  await runDocker(['volume', 'rm', '--force', name]);
}

/**
 * Harvest /workspace/output/ from a stopped (not yet removed) container via
 * `docker cp` streaming. Container must have been launched WITHOUT `--rm` so
 * the filesystem survives until we `docker rm` it explicitly.
 */
export async function harvestOutput(
  containerName: string,
  caps: { perFileMax: number; totalMax: number },
): Promise<{
  files: {
    name: string;
    contentBase64: string;
    size: number;
    contentType: string;
  }[];
  truncatedCount: number;
}> {
  const tarResult = await runDocker(
    ['cp', `${containerName}:/workspace/output/.`, '-'],
    { captureBinaryStdout: true },
  );
  if (tarResult.exitCode !== 0) {
    return { files: [], truncatedCount: 0 };
  }
  return parseTarStream(tarResult.stdoutBytes ?? new Uint8Array(0), caps);
}

function parseTarStream(
  buf: Uint8Array,
  caps: { perFileMax: number; totalMax: number },
): {
  files: {
    name: string;
    contentBase64: string;
    size: number;
    contentType: string;
  }[];
  truncatedCount: number;
} {
  // Tar parser — POSIX/USTAR format, 512-byte blocks.
  const files: {
    name: string;
    contentBase64: string;
    size: number;
    contentType: string;
  }[] = [];
  let truncatedCount = 0;
  let totalAccepted = 0;
  let i = 0;
  const td = new TextDecoder('utf-8');

  while (i + 512 <= buf.length) {
    const header = buf.subarray(i, i + 512);
    let allZero = true;
    for (let j = 0; j < 512; j++) {
      if (header[j] !== 0) {
        allZero = false;
        break;
      }
    }
    if (allZero) break;

    const name = td.decode(header.subarray(0, 100)).replace(/\0+$/, '');
    const sizeOctal = td
      .decode(header.subarray(124, 124 + 12))
      .replace(/[ \0]+$/, '');
    const size = parseInt(sizeOctal, 8);
    const typeflag = header[156];
    i += 512;
    if (Number.isNaN(size)) break;

    const bodyEnd = i + size;
    if (bodyEnd > buf.length) break;
    if ((typeflag === 0x30 || typeflag === 0) && size > 0) {
      const cleanName = name.replace(/^\.\//, '');
      if (cleanName && !cleanName.endsWith('/')) {
        if (size > caps.perFileMax || totalAccepted + size > caps.totalMax) {
          truncatedCount += 1;
        } else {
          const body = buf.subarray(i, bodyEnd);
          files.push({
            name: cleanName,
            contentBase64: Buffer.from(body).toString('base64'),
            size,
            contentType: guessContentType(cleanName),
          });
          totalAccepted += size;
        }
      }
    }
    i = bodyEnd + ((512 - (size % 512)) % 512);
  }
  return { files, truncatedCount };
}

function guessContentType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pptx'))
    return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.xlsx'))
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.docx'))
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.csv')) return 'text/csv; charset=utf-8';
  if (lower.endsWith('.txt') || lower.endsWith('.log'))
    return 'text/plain; charset=utf-8';
  if (lower.endsWith('.html')) return 'text/html; charset=utf-8';
  return 'application/octet-stream';
}
