import { randomUUID } from 'node:crypto';
import {
  copyFile,
  link,
  mkdir,
  readFile,
  readdir,
  stat,
  unlink,
  utimes,
} from 'node:fs/promises';
import { join } from 'node:path';

import { lock } from 'proper-lockfile';

/** Deployment-owned build artifacts, shared by both frontend colours. */
export const STATIC_ASSETS_DIR = '/app/static-assets';
export const STATIC_ASSET_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const HASHED_ASSET =
  /^[A-Za-z0-9._-]+-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|ttf|png|jpe?g|gif|svg|webp|avif|ico|wasm)(?:\.map)?$/;

/** Only immutable bundle names can cross releases; HTML and user data cannot. */
export function retainedAssetName(pathname: string): string | undefined {
  const name = pathname.startsWith('/assets/')
    ? pathname.slice('/assets/'.length)
    : '';
  return HASHED_ASSET.test(name) ? name : undefined;
}

/**
 * Publish complete files before the replica starts listening. A hard link
 * installs the finished copy atomically without replacing another replica's
 * artifact. Repeated publication extends retention for bundles still shipped.
 */
export async function publishStaticAssets(
  sourceDir: string,
  destinationDir = STATIC_ASSETS_DIR,
  now = Date.now(),
): Promise<void> {
  // Only Vite-emitted artifacts cross releases. Public files can resemble a
  // hash (apple-touch-icon-180x180.png) but are mutable and must stay local.
  const manifest: unknown = JSON.parse(
    await readFile(join(sourceDir, '..', 'pwa-build.json'), 'utf8'),
  );
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    !('assets' in manifest) ||
    !Array.isArray(manifest.assets) ||
    !manifest.assets.every((name: unknown) => typeof name === 'string')
  ) {
    throw new Error('Missing immutable assets in the PWA build manifest');
  }
  const emitted = new Set<unknown>(manifest.assets);
  await mkdir(destinationDir, { recursive: true });
  // Both colours can boot together. Serialize publication and expiry so a
  // sweep cannot remove an artifact another replica has just refreshed.
  // Keep the lease inside the shared mount; the library renews it and can
  // recover a crashed publisher's stale lease.
  const release = await lock(destinationDir, {
    lockfilePath: join(destinationDir, '.publish-lock'),
    stale: 30_000,
    update: 10_000,
    retries: { retries: 300, factor: 1, minTimeout: 100, maxTimeout: 100 },
  });
  try {
    await publishAndSweep(sourceDir, destinationDir, emitted, now);
  } finally {
    await release();
  }
}

/** Keep a running colour's artifacts alive even when releases are weeks apart.
 * Only stopped builds age out. A later startup must not prune the live colour
 * during the overlap simply because its original publication was long ago. */
export function maintainStaticAssets(
  sourceDir: string,
  destinationDir = STATIC_ASSETS_DIR,
  intervalMs = 60 * 60 * 1000,
): () => Promise<void> {
  let pending: Promise<void> | undefined;
  const timer = setInterval(() => {
    pending ??= publishStaticAssets(sourceDir, destinationDir)
      .catch((error: unknown) => {
        console.error('[platform] immutable asset maintenance failed', error);
      })
      .finally(() => {
        pending = undefined;
      });
  }, intervalMs);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await pending;
  };
}

async function publishAndSweep(
  sourceDir: string,
  destinationDir: string,
  emitted: ReadonlySet<unknown>,
  now: number,
): Promise<void> {
  for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
    if (
      !entry.isFile() ||
      !HASHED_ASSET.test(entry.name) ||
      !emitted.has(`assets/${entry.name}`)
    )
      continue;
    const destination = join(destinationDir, entry.name);
    const temporary = join(destinationDir, '.publish-' + randomUUID());
    try {
      await copyFile(join(sourceDir, entry.name), temporary);
      try {
        await link(temporary, destination);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !('code' in error) ||
          error.code !== 'EEXIST'
        )
          throw error;
      }
      await utimes(destination, new Date(now), new Date(now));
    } finally {
      await unlink(temporary).catch((error: unknown) => {
        if (
          !(error instanceof Error) ||
          !('code' in error) ||
          error.code !== 'ENOENT'
        )
          throw error;
      });
    }
  }
  // Sweep only our immutable artifacts. The volume carries no application
  // state, and unrelated files are never removed.
  for (const entry of await readdir(destinationDir, { withFileTypes: true })) {
    if (!entry.isFile() || !HASHED_ASSET.test(entry.name)) continue;
    const destination = join(destinationDir, entry.name);
    try {
      if ((await stat(destination)).mtimeMs < now - STATIC_ASSET_RETENTION_MS)
        await unlink(destination);
    } catch (error) {
      // Another boot may already have swept the same artifact.
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      )
        throw error;
    }
  }
}
