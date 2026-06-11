// DockerBackend's Workspace: a per-execution directory under the host session
// root. The spawner bind-mounts this exact path 1:1 into the runtime
// container (see docker-args.ts), so staging via node:fs and harvesting back
// are direct filesystem reads/writes — no transport step. `finalizeStaging()`
// chowns the tree so the unprivileged runtime user can read it; `destroy()` is
// the post-run `rm -rf`.

import { lchown, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { Workspace } from '../types.ts';

const RUNTIME_UID = 65534;
const RUNTIME_GID = 65534;

export class HostDirWorkspace implements Workspace {
  readonly localRoot: string;

  constructor(hostSessionRoot: string, executionId: string) {
    // executionId is validated by the caller (ID_ALPHABET_RE) before reaching
    // here; join keeps it a single path segment under the session root.
    this.localRoot = join(hostSessionRoot, executionId);
  }

  // The spawner runs as root; the runtime container runs as nobody (65534) and
  // reads the bind-mounted files. Recursive `lchown` (not `chown`) so a symlink
  // the runtime planted into the workspace CANNOT redirect ownership of an
  // arbitrary host file (audit finding R2-B4).
  async finalizeStaging(): Promise<void> {
    await chownRecursive(this.localRoot, RUNTIME_UID, RUNTIME_GID);
  }

  async destroy(): Promise<void> {
    try {
      await rm(this.localRoot, { recursive: true, force: true });
    } catch (err) {
      // Loud: silent rm failures = host disk leak (audit finding).
      console.warn(
        `[sandbox.cleanup] failed to rm host workspace ${this.localRoot}:`,
        err,
      );
    }
  }
}

async function chownRecursive(
  path: string,
  uid: number,
  gid: number,
): Promise<void> {
  await lchown(path, uid, gid);
  const entries = await readdir(path, { withFileTypes: true });
  for (const e of entries) {
    const p = join(path, e.name);
    if (e.isDirectory()) {
      await chownRecursive(p, uid, gid);
    } else {
      await lchown(p, uid, gid);
    }
  }
}
