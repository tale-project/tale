// DockerBackend's Workspace: a per-execution directory under the host session
// root. The spawner bind-mounts this exact path 1:1 into the runtime
// container (see docker-args.ts), so staging via node:fs and harvesting back
// are direct filesystem reads/writes — no transport step. `destroy()` is the
// post-run `rm -rf` that the executeRequest finally block used to do inline.

import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { Workspace } from '../types.ts';

export class HostDirWorkspace implements Workspace {
  readonly localRoot: string;

  constructor(hostSessionRoot: string, executionId: string) {
    // executionId is validated by the caller (ID_ALPHABET_RE) before reaching
    // here; join keeps it a single path segment under the session root.
    this.localRoot = join(hostSessionRoot, executionId);
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
