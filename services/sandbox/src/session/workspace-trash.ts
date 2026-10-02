// The Docker backend's workspace trash: where a destroyed session's workspace
// goes, so that the destroy never waits for the deletion.
//
// A workspace can hold tens of GB in over a million files, and deleting that
// on network block storage outlasts any caller (the platform gives a destroy
// 30 s). So once the session's container is confirmed gone, the destroy
// renames the workspace dir into `<root>/.trash/` — one directory entry
// changed on the same filesystem, whatever the workspace holds — and answers.
// A background pass then empties the trash one entry after another, so a burst
// of destroys never floods the disk under the sessions still running.
//
// The id is free the moment the rename lands: a new session under it lays out
// a fresh `ses-<id>`, and every trash entry carries a random suffix of its
// own, so destroying that new session never meets the old workspace still
// being deleted.
//
// Trash that a restart or a crash cut short stays on disk until the boot sweep
// empties it (cleanup.ts), and the periodic sweep retries what a pass could not
// remove. `.trash/` is a dot-dir, and its entries' names carry a `.`: the
// host-dir sweep, the workspace inventory and the legacy colour-root scan
// never take it, or anything in it, for a workspace.

import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, rename, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';

/** The trash dir under the host session root. */
const TRASH_DIR_NAME = '.trash';

/** A removal that took at least this long is logged: a render's small
 * workspace goes every few minutes, while a large one is what an operator
 * watching the disk wants to see come back. */
const LOG_REMOVAL_AFTER_MS = 1_000;

/** How the trash deletes one tree. */
export type RemoveTree = (path: string) => Promise<void>;

const removeTree: RemoveTree = (path) =>
  rm(path, { recursive: true, force: true });

function isMissing(err: unknown): boolean {
  return err instanceof Error && 'code' in err && err.code === 'ENOENT';
}

/** Is there a directory entry under `path`? One that cannot be checked
 * counts as there. */
async function entryExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (err) {
    return !isMissing(err);
  }
}

export class WorkspaceTrash {
  readonly dir: string;
  private pass: Promise<void> | null = null;
  private passAgain = false;

  /** @param remove Deletes one tree; tests hand in one they can hold. */
  constructor(
    root: string,
    private readonly remove: RemoveTree = removeTree,
  ) {
    this.dir = join(root, TRASH_DIR_NAME);
  }

  /**
   * Take `path` out of use and have it deleted. Resolves once nothing is left
   * under the name: the tree was renamed into the trash, which a background
   * pass empties, or there was nothing there. When the rename cannot happen
   * (another filesystem, no room for a directory entry), the tree is deleted
   * in place before this resolves, as it was before the trash existed — and
   * that THROWS when it fails, leaving what it could not remove where it was.
   */
  async discard(path: string): Promise<void> {
    try {
      // What waits in the trash is nobody's to read any more: only the
      // spawner, which deletes it, may enter.
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      await rename(path, join(this.dir, `${basename(path)}.${randomUUID()}`));
    } catch (err) {
      // Nothing under the name: an earlier destroy took it.
      if (isMissing(err) && !(await entryExists(path))) return;
      console.warn(
        `[sandbox.trash] cannot move ${path} into ${this.dir}; deleting it in place:`,
        err,
      );
      await this.remove(path);
      return;
    }
    void this.empty();
  }

  /**
   * Delete everything in the trash, one entry after another. One pass runs at
   * a time: a call while one runs shares its promise, and the pass reads the
   * trash again before it ends, so whatever was discarded meanwhile goes too.
   * Never rejects — an entry that cannot be removed is logged and stays for
   * the next pass.
   */
  empty(): Promise<void> {
    if (this.pass !== null) {
      this.passAgain = true;
      return this.pass;
    }
    const pass = this.drain()
      .catch((err: unknown) => {
        console.warn(`[sandbox.trash] emptying ${this.dir} failed:`, err);
      })
      .finally(() => {
        this.pass = null;
      });
    this.pass = pass;
    return pass;
  }

  private async drain(): Promise<void> {
    do {
      this.passAgain = false;
      let names: string[];
      try {
        names = await readdir(this.dir);
      } catch (err) {
        // No trash yet: nothing was ever discarded under this root.
        if (!isMissing(err)) {
          console.warn(`[sandbox.trash] cannot read ${this.dir}:`, err);
        }
        return;
      }
      for (const name of names) {
        const path = join(this.dir, name);
        const startedAtMs = Date.now();
        try {
          await this.remove(path);
        } catch (err) {
          console.warn(
            `[sandbox.trash] removing ${path} failed; the next pass retries it:`,
            err,
          );
          continue;
        }
        const tookMs = Date.now() - startedAtMs;
        if (tookMs >= LOG_REMOVAL_AFTER_MS) {
          console.log(
            `[sandbox.trash] removed ${name} in ${(tookMs / 1000).toFixed(1)} s`,
          );
        }
      }
    } while (this.passAgain);
  }
}

const trashes = new Map<string, WorkspaceTrash>();

/** The trash of a host session root. One per root, so the destroys, the boot
 * sweep and the periodic sweep share its single pass. */
export function workspaceTrash(root: string): WorkspaceTrash {
  let trash = trashes.get(root);
  if (trash === undefined) {
    trash = new WorkspaceTrash(root);
    trashes.set(root, trash);
  }
  return trash;
}
