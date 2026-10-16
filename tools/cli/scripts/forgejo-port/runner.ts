/**
 * The forgejo-runner the port is held to.
 *
 * `forgejo-runner validate` reads a workflow against the runner's schema and
 * `forgejo-runner exec --list` plans it, so a file that passes both is one the node's
 * runner reads. The version is the one the ops repository pins for the node
 * (`FORGEJO_RUNNER_VERSION` and `FORGEJO_RUNNER_LINUX_AMD64_SHA256` in its
 * `scripts/pins.yml`); the cut-over compares the two.
 */

import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const RUNNER = {
  version: '13.2.0',
  /** SHA-256 of `forgejo-runner-<version>-linux-amd64`. */
  linuxAmd64Sha256:
    'fadaec897f5e6641c363f87ecaf75f866f99c81b7097ec6b433e4c48123fcad1',
} as const;

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * The pinned binary, downloaded once into `cache` and checked against its digest.
 * Only the linux/amd64 build is pinned, so on another platform this is `undefined`
 * and a caller points `FORGEJO_RUNNER` at a binary it can run.
 */
export async function pinnedRunner(
  cache: string,
  platform: { os: string; arch: string } = {
    os: process.platform,
    arch: process.arch,
  },
  get: typeof fetch = fetch,
  digest: string = RUNNER.linuxAmd64Sha256,
): Promise<string | undefined> {
  if (platform.os !== 'linux' || platform.arch !== 'x64') return undefined;
  const path = join(cache, `forgejo-runner-${RUNNER.version}-linux-amd64`);
  const held = await readFile(path).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  });
  if (held !== undefined && sha256(held) === digest) return path;
  try {
    const response = await get(
      `https://code.forgejo.org/forgejo/runner/releases/download/v${RUNNER.version}/forgejo-runner-${RUNNER.version}-linux-amd64`,
      { signal: AbortSignal.timeout(60_000) },
    );
    if (!response.ok) return undefined;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (sha256(bytes) !== digest) return undefined;
    await mkdir(cache, { recursive: true });
    await writeFile(path, bytes);
    await chmod(path, 0o755);
    return path;
  } catch (error) {
    console.warn(
      `forgejo-port: could not download the pinned runner: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}
