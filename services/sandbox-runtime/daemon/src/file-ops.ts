// Workspace file operations for runnerd: stage files from presigned URLs,
// list directory entries, read file bytes. All paths are validated to resolve
// under the workspace root (no traversal, no symlink escape) — the same
// boundary the exec cwd check enforces.

import {
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
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
  /** URL the daemon GETs to fetch the bytes. Exactly one of `url` /
   * `contentBase64` must be set. */
  url?: string;
  /** Inline bytes, base64. For small control files the platform pushes
   * directly (e.g. mid-turn steer messages) — no URL round-trip. */
  contentBase64?: string;
}

interface StageResult {
  staged: Array<{ path: string; bytes: number }>;
  skipped: Array<{ path: string; reason: string }>;
}

const FETCH_MAX_BYTES = 100 * 1024 * 1024;
const INLINE_MAX_BYTES = 1 * 1024 * 1024;
/** Per-item deadline on a URL fetch (headers AND body). Under the spawner's
 * 30 s RPC bound on the whole stage call: without a deadline of its own the
 * daemon kept a stalled or trickling blob server's handler + accumulated
 * buffers alive for undici's 300 s defaults (unbounded for a trickle) long
 * after the spawner had already reported a timeout, and every later item in
 * the batch waited behind it. */
const STAGE_FETCH_TIMEOUT_MS = 25_000;

/** Write each item under the workspace (inline bytes, or fetched from its
 * URL). Skips (never throws) on a bad path, fetch failure, timeout, or
 * oversize, reporting a structured reason. */
export async function stageFiles(
  items: StageItem[],
  opts: { fetchTimeoutMs?: number } = {},
): Promise<StageResult> {
  const fetchTimeoutMs = opts.fetchTimeoutMs ?? STAGE_FETCH_TIMEOUT_MS;
  const staged: StageResult['staged'] = [];
  const skipped: StageResult['skipped'] = [];
  for (const item of items) {
    const abs = resolveUnderWorkspace(item.path);
    if (abs === null) {
      skipped.push({ path: item.path, reason: 'unsafe_path' });
      continue;
    }
    try {
      let buf: Buffer | number | 'too_large' | 'no_body';
      if (item.contentBase64 !== undefined) {
        buf = Buffer.from(item.contentBase64, 'base64');
        if (buf.byteLength > INLINE_MAX_BYTES) {
          skipped.push({ path: item.path, reason: 'too_large' });
          continue;
        }
      } else if (item.url !== undefined) {
        const ac = new AbortController();
        const deadline = setTimeout(() => ac.abort(), fetchTimeoutMs);
        try {
          buf = await fetchBounded(item.url, ac.signal);
        } finally {
          clearTimeout(deadline);
        }
        if (buf === 'too_large' || buf === 'no_body') {
          skipped.push({ path: item.path, reason: buf });
          continue;
        }
        if (typeof buf === 'number') {
          skipped.push({ path: item.path, reason: `http_${buf}` });
          continue;
        }
      } else {
        skipped.push({ path: item.path, reason: 'no_source' });
        continue;
      }
      // node target — the daemon bundles with --target=node, so no Bun
      // globals. Bun.write created parent dirs; mkdir -p keeps that contract.
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, buf);
      staged.push({ path: item.path, bytes: buf.byteLength });
    } catch (err) {
      skipped.push({
        path: item.path,
        reason:
          err instanceof Error
            ? err.name === 'AbortError'
              ? 'timeout'
              : err.message
            : 'fetch_failed',
      });
    }
  }
  return { staged, skipped };
}

/** GET a stage URL under `signal`, stream-accumulating under FETCH_MAX_BYTES.
 * Returns the bytes, a non-2xx status, or a structured skip reason. */
async function fetchBounded(
  url: string,
  signal: AbortSignal,
): Promise<Buffer | number | 'too_large' | 'no_body'> {
  const res = await fetch(url, { signal });
  if (!res.ok) return res.status;
  // Reject up front on a declared length over the cap (cheap, no body
  // read). A truthful Content-Length avoids streaming a huge body at all.
  const declared = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > FETCH_MAX_BYTES) {
    return 'too_large';
  }
  if (res.body === null) return 'no_body';
  // Stream-accumulate so a missing/lying Content-Length can't OOM the
  // daemon: cancel the reader the instant the running total crosses the
  // cap (don't buffer the whole body first). The abort signal also rejects
  // reader.read(), so a trickling body is bounded by the same deadline.
  const reader = res.body.getReader();
  const parts: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    const part = Buffer.from(value);
    total += part.byteLength;
    if (total > FETCH_MAX_BYTES) {
      await reader.cancel();
      return 'too_large';
    }
    parts.push(part);
  }
  return Buffer.concat(parts);
}

interface DeleteResult {
  deleted: string[];
  skipped: Array<{ path: string; reason: string }>;
}

/** Remove each path (file or directory, recursive) under the workspace. Skips
 * (never throws) on a bad/escaping path or the root itself. Idempotent: a path
 * that is already absent counts as deleted (force) so reconcile callers can run
 * it unconditionally. `rm` unlinks a symlink rather than following it, so a
 * planted symlink can't delete outside the root. */
export async function deletePaths(paths: string[]): Promise<DeleteResult> {
  const deleted: string[] = [];
  const skipped: DeleteResult['skipped'] = [];
  for (const rel of paths) {
    const abs = resolveUnderWorkspace(rel);
    if (abs === null || abs === workspaceRoot()) {
      skipped.push({ path: rel, reason: 'unsafe_path' });
      continue;
    }
    try {
      await rm(abs, { recursive: true, force: true });
      deleted.push(rel);
    } catch (err) {
      skipped.push({
        path: rel,
        reason: err instanceof Error ? err.message : 'delete_failed',
      });
    }
  }
  return { deleted, skipped };
}

interface FsEntry {
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
