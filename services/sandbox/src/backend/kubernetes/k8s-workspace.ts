// A spawner-local staging directory for the K8s exec-tar transport. The
// spawner stages inputs here (node:fs) and harvests outputs back here; the
// backend tars the tree into/out of the runtime Pod around the run.
//
// Unlike the docker HostDirWorkspace, finalizeStaging is a NO-OP: the holder
// sidecar's `tar -x` (running as uid 65534) re-owns the tree inside the Pod,
// so local ownership is irrelevant — and the spawner Pod need not run as root.

import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { Workspace } from '../types.ts';

export class K8sWorkspace implements Workspace {
  readonly localRoot: string;

  constructor(stagingRoot: string, executionId: string) {
    this.localRoot = join(stagingRoot, executionId);
  }

  async finalizeStaging(): Promise<void> {
    // No-op: tar-in into the Pod re-owns the tree as the runtime uid.
  }

  async destroy(): Promise<void> {
    try {
      await rm(this.localRoot, { recursive: true, force: true });
    } catch (err) {
      console.warn(
        `[sandbox.cleanup] failed to rm staging dir ${this.localRoot}:`,
        err,
      );
    }
  }
}
