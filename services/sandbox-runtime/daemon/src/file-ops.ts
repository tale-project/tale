// Workspace file operations for runnerd: stage files from presigned URLs,
// list directory entries, read file bytes. All paths are validated to resolve
// under the workspace root (no traversal, no symlink escape) — the same
// boundary the exec cwd check enforces.

import {
  mkdir,
  readdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';

import { WORKSPACE_ROOT } from './protocol.ts';

function workspaceRoot(): string {
  return process.env.TALE_WORKSPACE_ROOT ?? WORKSPACE_ROOT;
}

/** Resolve a workspace-relative (or absolute-under-root) path to an absolute
 * path, rejecting traversal. Does NOT require existence (used for writes too);
 * for reads the caller stats afterwards. Returns null on rejection. */
function resolveUnderWorkspace(rel: string): string | null {
  const root = workspaceRoot();
  if (rel.includes('\0')) return null;
  const abs = normalize(rel.startsWith('/') ? rel : join(root, rel));
  if (abs !== root && !abs.startsWith(`${root}/`)) return null;
  return abs;
}

/** After a path exists, confirm its realpath still sits under the root (guards
 * a symlink the session planted pointing outside). */
async function realpathUnderRoot(abs: string): Promise<string | null> {
  try {
    const real = await realpath(abs);
    const root = await realpath(workspaceRoot());
    return real === root || real.startsWith(`${root}/`) ? real : null;
  } catch {
    return null;
  }
}

export interface StageItem {
  /** Workspace-relative destination path. */
  path: string;
  /** URL the daemon GETs to fetch the bytes. */
  url: string;
}

export interface StageResult {
  staged: Array<{ path: string; bytes: number }>;
  skipped: Array<{ path: string; reason: string }>;
}

const FETCH_MAX_BYTES = 100 * 1024 * 1024;

/** Fetch each URL and write it under the workspace. Skips (never throws) on a
 * bad path, fetch failure, or oversize, reporting a structured reason. */
export async function stageFiles(items: StageItem[]): Promise<StageResult> {
  const staged: StageResult['staged'] = [];
  const skipped: StageResult['skipped'] = [];
  for (const item of items) {
    const abs = resolveUnderWorkspace(item.path);
    if (abs === null) {
      skipped.push({ path: item.path, reason: 'unsafe_path' });
      continue;
    }
    try {
      const res = await fetch(item.url);
      if (!res.ok) {
        skipped.push({ path: item.path, reason: `http_${res.status}` });
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength > FETCH_MAX_BYTES) {
        skipped.push({ path: item.path, reason: 'too_large' });
        continue;
      }
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, buf);
      staged.push({ path: item.path, bytes: buf.byteLength });
    } catch (err) {
      skipped.push({
        path: item.path,
        reason: err instanceof Error ? err.message : 'fetch_failed',
      });
    }
  }
  return { staged, skipped };
}

export interface FsEntry {
  name: string;
  type: 'file' | 'dir' | 'other';
  size: number;
  mtimeMs: number;
}

export async function listDir(rel: string): Promise<FsEntry[] | null> {
  const abs = resolveUnderWorkspace(rel);
  if (abs === null) return null;
  if ((await realpathUnderRoot(abs)) === null) return null;
  const out: FsEntry[] = [];
  try {
    const entries = await readdir(abs, { withFileTypes: true });
    for (const e of entries) {
      let size = 0;
      let mtimeMs = 0;
      try {
        const st = await stat(join(abs, e.name));
        size = st.size;
        mtimeMs = st.mtimeMs;
      } catch {
        // entry vanished between readdir and stat — report it with zeros.
      }
      out.push({
        name: e.name,
        type: e.isDirectory() ? 'dir' : e.isFile() ? 'file' : 'other',
        size,
        mtimeMs,
      });
    }
  } catch {
    return null;
  }
  return out;
}

/** Read a file's bytes, capped. Returns null on bad path / not a file /
 * oversize. */
export async function readWorkspaceFile(
  rel: string,
  maxBytes: number,
): Promise<Buffer | null> {
  const abs = resolveUnderWorkspace(rel);
  if (abs === null) return null;
  if ((await realpathUnderRoot(abs)) === null) return null;
  try {
    const st = await stat(abs);
    if (!st.isFile() || st.size > maxBytes) return null;
    return await readFile(abs);
  } catch {
    return null;
  }
}
