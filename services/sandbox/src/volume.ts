// Workspace + per-org cache volume helpers.
//
// Workspace = ephemeral tmpfs Docker volume, 256 MB hard ENOSPC cap (R2.2).
// Per-org pip/npm cache = persistent named volumes scoped to organizationId
// (R2.3 — closes the cross-tenant wheel-cache poison vector).

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

export function workspaceVolumeName(executionId: string): string {
  return `tale-sbx-${executionId}`;
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

/** Create a sized tmpfs Docker volume (RAM-backed, hard ENOSPC at sizeMb). */
export async function createWorkspaceVolume(
  executionId: string,
  sizeMb = 256,
): Promise<string> {
  const name = workspaceVolumeName(executionId);
  const result = await runDocker([
    'volume',
    'create',
    '--driver=local',
    '--label',
    'tale.sandbox=1',
    `--label`,
    `tale.session=${executionId}`,
    '--opt',
    'type=tmpfs',
    '--opt',
    'device=tmpfs',
    '--opt',
    `o=size=${sizeMb}m,nosuid,nodev`,
    name,
  ]);
  if (result.exitCode !== 0) {
    throw new Error(
      `volume: failed to create workspace volume ${name}: ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
  return name;
}

/**
 * Create per-org cache volume lazily (idempotent: docker volume create
 * succeeds on an existing volume).
 */
export async function ensureCacheVolume(name: string): Promise<void> {
  const result = await runDocker([
    'volume',
    'create',
    '--label',
    'tale.sandbox-cache=1',
    name,
  ]);
  if (result.exitCode !== 0) {
    throw new Error(
      `volume: failed to ensure cache volume ${name}: ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
}

export async function removeVolume(name: string): Promise<void> {
  // Best-effort; don't throw on missing volume so retries are safe.
  await runDocker(['volume', 'rm', '--force', name]);
}

/**
 * Stage a code + packages + options bundle into the workspace volume via a
 * transient busybox container. We DO NOT pass the user code through argv;
 * we tar-pipe it in.
 */
export async function stageCodeIntoVolume(args: {
  volumeName: string;
  language: 'python' | 'node';
  code: string;
  packages: string[];
  options: { allowSdist?: boolean; allowInstallScripts?: boolean };
  inputFiles: { name: string; contentBase64: string }[];
}): Promise<void> {
  const mainName = args.language === 'python' ? 'main.py' : 'main.js';

  // Build the tar archive in-memory. Format = a series of files we then
  // pipe into `docker cp - container:/`.
  // It's simpler to use a one-shot helper container that reads our payload
  // from stdin and unpacks it.

  // Compose the script that the helper runs inside the volume. The helper is
  // busybox, mounting the volume at /workspace; it reads a JSON manifest from
  // stdin and writes the files we list. This keeps everything inside the
  // sandbox volume and never touches the host filesystem outside of the
  // mounted volume.
  const stageScript = `#!/bin/sh
set -e
mkdir -p /workspace/code /workspace/input /workspace/output
cat > /workspace/code/${mainName}
`;
  // The helper executes the staging script. We invoke docker run with the
  // user code piped to it on stdin (NOT via argv).
  const helperArgs = [
    'run',
    '--rm',
    '-i',
    '--label',
    'tale.sandbox-staging=1',
    '--user',
    '0:0',
    '--mount',
    `type=volume,src=${args.volumeName},dst=/workspace`,
    '--entrypoint',
    'sh',
    'busybox:1.36',
    '-c',
    stageScript,
  ];

  const codeResult = await runDocker(helperArgs, { stdin: args.code });
  if (codeResult.exitCode !== 0) {
    throw new Error(
      `volume: failed to stage code: ${codeResult.stderr.trim()}`,
    );
  }

  // Stage packages.json + options.json
  const packagesJson = JSON.stringify(args.packages);
  const optionsJson = JSON.stringify(args.options);
  const writePackages = await runDocker(
    [
      'run',
      '--rm',
      '-i',
      '--label',
      'tale.sandbox-staging=1',
      '--user',
      '0:0',
      '--mount',
      `type=volume,src=${args.volumeName},dst=/workspace`,
      '--entrypoint',
      'sh',
      'busybox:1.36',
      '-c',
      'cat > /workspace/code/packages.json',
    ],
    { stdin: packagesJson },
  );
  if (writePackages.exitCode !== 0) {
    throw new Error(
      `volume: failed to write packages.json: ${writePackages.stderr.trim()}`,
    );
  }

  const writeOptions = await runDocker(
    [
      'run',
      '--rm',
      '-i',
      '--label',
      'tale.sandbox-staging=1',
      '--user',
      '0:0',
      '--mount',
      `type=volume,src=${args.volumeName},dst=/workspace`,
      '--entrypoint',
      'sh',
      'busybox:1.36',
      '-c',
      'cat > /workspace/code/options.json',
    ],
    { stdin: optionsJson },
  );
  if (writeOptions.exitCode !== 0) {
    throw new Error(
      `volume: failed to write options.json: ${writeOptions.stderr.trim()}`,
    );
  }

  // Input files (base64). Each is decoded and dropped under /workspace/input/.
  for (const f of args.inputFiles) {
    if (!/^[a-zA-Z0-9._-]+$/.test(f.name)) {
      throw new Error(`volume: rejected unsafe input file name: ${f.name}`);
    }
    const writeInput = await runDocker(
      [
        'run',
        '--rm',
        '-i',
        '--label',
        'tale.sandbox-staging=1',
        '--user',
        '0:0',
        '--mount',
        `type=volume,src=${args.volumeName},dst=/workspace`,
        '--entrypoint',
        'sh',
        'busybox:1.36',
        '-c',
        `base64 -d > /workspace/input/${f.name}`,
      ],
      { stdin: f.contentBase64 },
    );
    if (writeInput.exitCode !== 0) {
      throw new Error(
        `volume: failed to write input file ${f.name}: ${writeInput.stderr.trim()}`,
      );
    }
  }

  // Ensure ownership so the unprivileged sandbox user can read the staged files.
  const chown = await runDocker([
    'run',
    '--rm',
    '--label',
    'tale.sandbox-staging=1',
    '--user',
    '0:0',
    '--mount',
    `type=volume,src=${args.volumeName},dst=/workspace`,
    '--entrypoint',
    'sh',
    'busybox:1.36',
    '-c',
    'chown -R 65534:65534 /workspace',
  ]);
  if (chown.exitCode !== 0) {
    throw new Error(
      `volume: failed to chown workspace: ${chown.stderr.trim()}`,
    );
  }
}

/** Read the contents of /workspace/output/ as base64-encoded files. */
export async function harvestOutput(
  volumeName: string,
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
  // Use `docker run -i tar c -C /workspace/output .` to stream a tar; parse it.
  // Bun supports child_process; we tee-into a buffer.
  const tarResult = await runDocker(
    [
      'run',
      '--rm',
      '--label',
      'tale.sandbox-staging=1',
      '--user',
      '0:0',
      '--mount',
      `type=volume,src=${volumeName},dst=/workspace`,
      '--entrypoint',
      'sh',
      'busybox:1.36',
      '-c',
      // -h follows symlinks (matters if user code symlinks). --to-stdout via -O
      // for individual files but tar is simpler.
      'cd /workspace/output 2>/dev/null && tar -cf - . 2>/dev/null || true',
    ],
    { captureBinaryStdout: true },
  );

  if (tarResult.exitCode !== 0) {
    return { files: [], truncatedCount: 0 };
  }

  return parseTarStream(tarResult.stdoutBytes ?? new Uint8Array(0), caps);
}

interface TarEntry {
  name: string;
  size: number;
  body: Uint8Array;
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
    // Check for end-of-archive (two consecutive zero blocks).
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
    // Regular file: typeflag '0' (0x30) or '\0'
    if ((typeflag === 0x30 || typeflag === 0) && size > 0) {
      // Strip leading ./
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
    // Advance to next 512-aligned boundary.
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
