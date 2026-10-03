// Workspace file operations for runnerd: stage files from presigned URLs,
// list directory entries, read file bytes. All paths are validated to resolve
// under the workspace root (no traversal, no symlink escape) — the same
// boundary the exec cwd check enforces.

import { randomUUID } from 'node:crypto';
import {
  mkdir,
  open,
  rename,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
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

/** Stream each input into an owned temporary file, then publish with rename.
 * Neither a failed fetch nor a disconnected caller can leave a partial target.
 * The batch shares one deadline below the spawner's 30 s RPC bound. */
export async function stageFiles(
  items: StageItem[],
  opts: {
    fetchTimeoutMs?: number;
    batchTimeoutMs?: number;
    fetchMaxBytes?: number;
    signal?: AbortSignal;
  } = {},
): Promise<StageResult> {
  const deadline = new AbortController();
  const timer = setTimeout(
    () => deadline.abort(),
    opts.batchTimeoutMs ?? STAGE_FETCH_TIMEOUT_MS,
  );
  const signal = opts.signal
    ? AbortSignal.any([opts.signal, deadline.signal])
    : deadline.signal;
  const staged: StageResult['staged'] = [];
  const skipped: StageResult['skipped'] = [];
  try {
    for (const item of items) {
      if (signal.aborted) {
        skipped.push({
          path: item.path,
          reason: opts.signal?.aborted ? 'cancelled' : 'timeout',
        });
        continue;
      }
      const abs = resolveUnderWorkspace(item.path);
      if (abs === null || abs === workspaceRoot()) {
        skipped.push({ path: item.path, reason: 'unsafe_path' });
        continue;
      }
      const itemAbort = new AbortController();
      const itemTimer = setTimeout(
        () => itemAbort.abort(),
        opts.fetchTimeoutMs ?? STAGE_FETCH_TIMEOUT_MS,
      );
      const itemSignal = AbortSignal.any([signal, itemAbort.signal]);
      let temporary: string | undefined;
      try {
        const parent = dirname(abs);
        // Check existing ancestors before mkdir, then the completed parent.
        let ancestor = parent;
        while ((await realpathUnderRoot(ancestor)) === null) {
          try {
            await realpath(ancestor);
            throw new Error('unsafe_path');
          } catch (error) {
            if (
              !(
                error instanceof Error &&
                'code' in error &&
                error.code === 'ENOENT'
              )
            )
              throw error;
          }
          const next = dirname(ancestor);
          if (next === ancestor) throw new Error('unsafe_path');
          ancestor = next;
        }
        await mkdir(parent, { recursive: true });
        if ((await realpathUnderRoot(parent)) === null)
          throw new Error('unsafe_path');
        temporary = join(parent, `.tale-stage-${randomUUID()}`);
        const target = await open(temporary, 'wx', 0o600);
        let bytes = 0;
        try {
          if (item.contentBase64 !== undefined) {
            // Refuse before decoding: an oversized base64 string should not
            // allocate its entire decoded counterpart merely to reject it.
            if (item.contentBase64.length > Math.ceil(INLINE_MAX_BYTES / 3) * 4)
              throw new Error('too_large');
            const content = Buffer.from(item.contentBase64, 'base64');
            if (content.byteLength > INLINE_MAX_BYTES)
              throw new Error('too_large');
            itemSignal.throwIfAborted();
            await target.writeFile(content);
            bytes = content.byteLength;
          } else if (item.url !== undefined) {
            const response = await fetch(item.url, { signal: itemSignal });
            const limit = opts.fetchMaxBytes ?? FETCH_MAX_BYTES;
            try {
              if (!response.ok) throw new Error(`http_${response.status}`);
              const declared = Number(
                response.headers.get('content-length') ?? '',
              );
              if (Number.isFinite(declared) && declared > limit)
                throw new Error('too_large');
              if (response.body === null) throw new Error('no_body');
              const reader = response.body.getReader();
              try {
                for (;;) {
                  itemSignal.throwIfAborted();
                  const { done, value } = await reader.read();
                  if (done) break;
                  bytes += value.byteLength;
                  if (bytes > limit) throw new Error('too_large');
                  let offset = 0;
                  while (offset < value.byteLength) {
                    itemSignal.throwIfAborted();
                    const written = await target.write(
                      value,
                      offset,
                      value.byteLength - offset,
                    );
                    if (written.bytesWritten === 0)
                      throw new Error('write_failed');
                    offset += written.bytesWritten;
                  }
                }
              } finally {
                reader.releaseLock();
              }
            } finally {
              // Includes non-2xx and declared-oversize bodies: releasing a
              // reader's lock alone does not close the upstream connection.
              await response.body?.cancel().catch(() => {});
            }
          } else {
            throw new Error('no_source');
          }
        } finally {
          await target.close();
        }
        itemSignal.throwIfAborted();
        if ((await realpathUnderRoot(dirname(abs))) === null)
          throw new Error('unsafe_path');
        await rename(temporary, abs);
        temporary = undefined;
        staged.push({ path: item.path, bytes });
      } catch (error) {
        skipped.push({
          path: item.path,
          reason: opts.signal?.aborted
            ? 'cancelled'
            : itemSignal.aborted
              ? 'timeout'
              : error instanceof Error
                ? error.message
                : 'fetch_failed',
        });
      } finally {
        clearTimeout(itemTimer);
        itemAbort.abort();
        if (temporary !== undefined)
          await rm(temporary, { force: true }).catch(() => {});
      }
    }
  } finally {
    clearTimeout(timer);
  }
  return { staged, skipped };
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
