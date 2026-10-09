// The Docker backend's workspace inventory: every session workspace dir under
// the host session root, stopped sessions' preserved data included. The
// platform compares it with its own ownership records to find workspaces
// nothing owns any more (see docs/sessions.md, "Workspace cleanup").
//
// Layouts, the same two the resume resolver and the host-dir sweep know:
//
//   <root>/ses-<id>            flat session workspace
//   <root>/<colour>/ses-<id>   legacy colour-rooted workspace (one level)
//
// Anything else — files, dot-dirs (`.pins/`, `.owners/`, the `.trash/` of
// destroyed workspaces), the spawner lock, names outside the id alphabet — is
// not a workspace and is not reported.
//
// Leaving a workspace OUT is always safe: the platform only ever destroys a
// workspace this list names and its records disown. So a dir that cannot be
// read below the root is skipped with a warning rather than failing the whole
// inventory; only an unreadable root fails it, where an empty answer would
// hide every problem.

import type { Dirent, Stats } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { ID_ALPHABET_RE } from '../wire.ts';
import { isSessionWorkspaceDirName } from './session-naming.ts';

export interface WorkspaceDir {
  sessionId: string;
  /** Newest mtime/ctime of the workspace dir itself. A resume re-chowns the
   * dir, so this moves on every resume as well as on a fresh create. */
  touchedAtMs: number;
}

function isMissing(err: unknown): boolean {
  return err instanceof Error && 'code' in err && err.code === 'ENOENT';
}

/** One directory level below the root, or null when it vanished (a
 * concurrent destroy) or cannot be read (logged). */
async function readNested(
  dir: string,
  requireComplete: boolean,
): Promise<Dirent[] | null> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (!isMissing(err)) {
      if (requireComplete) {
        throw new Error(`workspace inventory: cannot read ${dir}`, {
          cause: err,
        });
      }
      console.warn(`[sandbox.inventory] cannot read ${dir}; skipped:`, err);
    }
    return null;
  }
}

async function statOrNull(path: string): Promise<Stats | null> {
  try {
    return await stat(path);
  } catch (err) {
    if (!isMissing(err)) {
      console.warn(`[sandbox.inventory] cannot stat ${path}; skipped:`, err);
    }
    return null;
  }
}

/** The session id a workspace dir name carries, or null when the name is
 * not a workspace this spawner could have created. */
export function workspaceSessionId(dirName: string): string | null {
  if (!isSessionWorkspaceDirName(dirName)) return null;
  const sessionId = dirName.slice('ses-'.length);
  return ID_ALPHABET_RE.test(sessionId) ? sessionId : null;
}

/** The layout walk shared by the inventory and destroy. A destroy
 * requires a complete answer: clearing ownership after a partial walk would
 * strand whatever an unreadable legacy root still holds. */
async function readWorkspaceDirs(
  root: string,
  requireComplete: boolean,
): Promise<Array<{ sessionId: string; path: string }>> {
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (err) {
    if (isMissing(err)) return [];
    throw new Error(`workspace inventory: cannot read ${root}`, { cause: err });
  }
  const found: Array<{ sessionId: string; path: string }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sessionId = workspaceSessionId(entry.name);
    if (sessionId !== null) {
      found.push({ sessionId, path: join(root, entry.name) });
      continue;
    }
    // Only an id-alphabet name was ever a colour root; dot-dirs are the
    // spawner's own bookkeeping.
    if (entry.name.startsWith('.') || !ID_ALPHABET_RE.test(entry.name)) {
      continue;
    }
    const nested = await readNested(join(root, entry.name), requireComplete);
    if (nested === null) continue;
    for (const child of nested) {
      if (!child.isDirectory()) continue;
      const nestedId = workspaceSessionId(child.name);
      if (nestedId !== null) {
        found.push({
          sessionId: nestedId,
          path: join(root, entry.name, child.name),
        });
      }
    }
  }
  return found;
}

/** Every workspace dir under `root`, with the session it belongs to: a
 * session with copies in both layouts is listed once per copy. Dirs below the
 * root that cannot be read are left out (logged); an unreadable root THROWS. */
export function listWorkspacePaths(
  root: string,
): Promise<Array<{ sessionId: string; path: string }>> {
  return readWorkspaceDirs(root, false);
}

/** Every directory of one session, including copies left in legacy roots.
 * THROWS on an unreadable root instead of hiding data from its destroy. */
export async function listSessionWorkspaceDirs(
  root: string,
  sessionId: string,
): Promise<string[]> {
  return (await readWorkspaceDirs(root, true))
    .filter((dir) => dir.sessionId === sessionId)
    .map((dir) => dir.path);
}

/**
 * Every workspace dir under `root`, one entry per session id. A session whose
 * data exists in both layouts (a legacy dir left beside a flat one) is
 * reported once, touched at the newer of the two. Its destroy discards every
 * copy before clearing ownership. A missing root is an empty inventory (a
 * fresh host); an unreadable one THROWS.
 */
export async function listWorkspaceDirs(root: string): Promise<WorkspaceDir[]> {
  const found = new Map<string, number>();
  for (const { sessionId, path } of await readWorkspaceDirs(root, false)) {
    const st = await statOrNull(path);
    if (st === null) continue;
    const touchedAtMs = Math.max(st.mtimeMs, st.ctimeMs);
    found.set(sessionId, Math.max(found.get(sessionId) ?? 0, touchedAtMs));
  }
  return [...found].map(([sessionId, touchedAtMs]) => ({
    sessionId,
    touchedAtMs,
  }));
}
