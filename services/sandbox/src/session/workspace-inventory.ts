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
// Anything else — files, dot-dirs (`.pins/`, the spawner lock), names outside
// the id alphabet — is not a workspace and is not reported.
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
async function readNested(dir: string): Promise<Dirent[] | null> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (!isMissing(err)) {
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

/**
 * Every workspace dir under `root`, one entry per session id. A session whose
 * data exists in both layouts (a legacy dir left beside a flat one) is
 * reported once, touched at the newer of the two — destroying it resolves the
 * flat dir first and the legacy one on the next pass. A missing root is an
 * empty inventory (a fresh host); an unreadable one THROWS.
 */
export async function listWorkspaceDirs(root: string): Promise<WorkspaceDir[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (err) {
    if (isMissing(err)) return [];
    throw new Error(`workspace inventory: cannot read ${root}`, { cause: err });
  }
  const found = new Map<string, number>();
  const record = async (sessionId: string, path: string): Promise<void> => {
    const st = await statOrNull(path);
    if (st === null) return;
    const touchedAtMs = Math.max(st.mtimeMs, st.ctimeMs);
    found.set(sessionId, Math.max(found.get(sessionId) ?? 0, touchedAtMs));
  };
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sessionId = workspaceSessionId(entry.name);
    if (sessionId !== null) {
      await record(sessionId, join(root, entry.name));
      continue;
    }
    // Only an id-alphabet name was ever a colour root; dot-dirs are the
    // spawner's own bookkeeping.
    if (entry.name.startsWith('.') || !ID_ALPHABET_RE.test(entry.name)) {
      continue;
    }
    const nested = await readNested(join(root, entry.name));
    if (nested === null) continue;
    for (const child of nested) {
      if (!child.isDirectory()) continue;
      const nestedId = workspaceSessionId(child.name);
      if (nestedId !== null) {
        await record(nestedId, join(root, entry.name, child.name));
      }
    }
  }
  return [...found].map(([sessionId, touchedAtMs]) => ({
    sessionId,
    touchedAtMs,
  }));
}
