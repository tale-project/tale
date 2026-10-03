// Workspace file operations for runnerd: stage files from presigned URLs,
// list directory entries, read file bytes. All paths are validated to resolve
// under the workspace root (no traversal, no symlink escape) — the same
// boundary the exec cwd check enforces.

import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  type FileHandle,
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
  sha256?: string;
  /** Immutable source identity; only a locally verified digest permits reuse. */
  cacheKey?: string;
}

interface StageResult {
  staged: Array<{ path: string; bytes: number }>;
  skipped: Array<{ path: string; reason: string }>;
}

const FETCH_MAX_BYTES = 100 * 1024 * 1024;
const INLINE_MAX_BYTES = 1 * 1024 * 1024;
const stageCache = new Map<string, { cacheKey: string; sha256: string }>();

async function fileDigest(
  path: string,
  signal: AbortSignal,
): Promise<{ sha256: string; bytes: number }> {
  const digest = createHash('sha256');
  const stream = createReadStream(path, { signal });
  let bytes = 0;
  for await (const chunk of stream) {
    bytes += chunk.length;
    if (bytes > FETCH_MAX_BYTES) throw new Error('too_large');
    digest.update(chunk);
  }
  return { sha256: digest.digest('hex'), bytes };
}

/** Both a fetch and the entire batch finish before the spawner's 30s RPC
 * deadline. A slow item cannot leave the rest running after the caller left. */
const STAGE_FETCH_TIMEOUT_MS = 25_000;

async function stageParent(abs: string): Promise<string | null> {
  const parent = dirname(abs);
  // Check the nearest existing ancestor before mkdir follows any symlinks.
  let ancestor = parent;
  for (;;) {
    try {
      await stat(ancestor);
      if ((await realpathUnderRoot(ancestor)) === null) return null;
      break;
    } catch {
      const next = dirname(ancestor);
      if (next === ancestor) return null;
      ancestor = next;
    }
  }
  await mkdir(parent, { recursive: true });
  return realpathUnderRoot(parent);
}

/** Stage with two process-wide transfer slots and bounded memory. A destination becomes visible only
 * after all its bytes arrive; cancellation and failed uploads preserve it. */
export async function stageFiles(
  items: StageItem[],
  opts: {
    fetchTimeoutMs?: number;
    batchTimeoutMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<StageResult> {
  const fetchTimeoutMs = opts.fetchTimeoutMs ?? STAGE_FETCH_TIMEOUT_MS;
  const batch = new AbortController();
  const deadline = setTimeout(
    () => batch.abort(),
    opts.batchTimeoutMs ?? STAGE_FETCH_TIMEOUT_MS,
  );
  const signal = opts.signal
    ? AbortSignal.any([batch.signal, opts.signal])
    : batch.signal;
  const outcomes: StageResult[] = new Array(items.length);
  const destinations = new Set<string>();
  const duplicates = new Set<number>();
  for (const [index, item] of items.entries()) {
    const path = resolveUnderWorkspace(item.path);
    if (path && destinations.has(path)) duplicates.add(index);
    if (path) destinations.add(path);
  }
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next++;
      const item = items[index];
      if (!item) return;
      if (duplicates.has(index)) {
        outcomes[index] = {
          staged: [],
          skipped: [{ path: item.path, reason: 'duplicate_path' }],
        };
        continue;
      }
      const release = await takeStageSlot(signal);
      try {
        outcomes[index] = await stageItem(
          item,
          signal,
          fetchTimeoutMs,
          opts.signal,
        );
      } finally {
        release?.();
      }
    }
  };
  try {
    await Promise.all([worker(), worker()]);
  } finally {
    clearTimeout(deadline);
  }
  return {
    staged: outcomes.flatMap((result) => result.staged),
    skipped: outcomes.flatMap((result) => result.skipped),
  };
}

let activeStageTransfers = 0;
const stageWaiters: Array<() => void> = [];
function takeStageSlot(signal: AbortSignal): Promise<(() => void) | null> {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    const start = () => {
      signal.removeEventListener('abort', aborted);
      activeStageTransfers += 1;
      resolve(() => {
        activeStageTransfers -= 1;
        stageWaiters.shift()?.();
      });
    };
    const aborted = () => {
      const index = stageWaiters.indexOf(start);
      if (index !== -1) stageWaiters.splice(index, 1);
      resolve(null);
    };
    if (activeStageTransfers < 2) start();
    else {
      stageWaiters.push(start);
      signal.addEventListener('abort', aborted, { once: true });
    }
  });
}

async function stageItem(
  item: StageItem,
  signal: AbortSignal,
  fetchTimeoutMs: number,
  callerSignal?: AbortSignal,
): Promise<StageResult> {
  const staged: StageResult['staged'] = [];
  const skipped: StageResult['skipped'] = [];
  if (signal.aborted) {
    skipped.push({
      path: item.path,
      reason: callerSignal?.aborted ? 'cancelled' : 'timeout',
    });
    return { staged, skipped };
  }
  const abs = resolveUnderWorkspace(item.path);
  if (abs === null || abs === workspaceRoot()) {
    skipped.push({ path: item.path, reason: 'unsafe_path' });
    return { staged, skipped };
  }
  let temporary: string | undefined;
  let file: FileHandle | undefined;
  try {
    if (item.contentBase64 === undefined && item.url === undefined) {
      skipped.push({ path: item.path, reason: 'no_source' });
      return { staged, skipped };
    }
    const parent = await stageParent(abs);
    if (parent === null) {
      skipped.push({ path: item.path, reason: 'unsafe_path' });
      return { staged, skipped };
    }
    const cached = stageCache.get(abs);
    const expected =
      item.sha256 ??
      (item.cacheKey && cached?.cacheKey === item.cacheKey
        ? cached.sha256
        : undefined);
    if (expected && (await realpathUnderRoot(abs)) !== null) {
      const existing = await fileDigest(abs, signal).catch(() => null);
      if (existing?.sha256 === expected) {
        staged.push({ path: item.path, bytes: existing.bytes });
        return { staged, skipped };
      }
    }
    temporary = join(parent, `.tale-stage-${randomUUID()}`);
    file = await open(temporary, 'wx', 0o600);
    let bytes: number;
    if (item.contentBase64 !== undefined) {
      // Refuse before decoding a potentially oversized base64 string.
      if (item.contentBase64.length > Math.ceil(INLINE_MAX_BYTES / 3) * 4) {
        skipped.push({ path: item.path, reason: 'too_large' });
        return { staged, skipped };
      }
      const buf = Buffer.from(item.contentBase64, 'base64');
      if (buf.byteLength > INLINE_MAX_BYTES) {
        skipped.push({ path: item.path, reason: 'too_large' });
        return { staged, skipped };
      }
      await writeChunk(file, buf, signal);
      bytes = buf.byteLength;
    } else {
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), fetchTimeoutMs);
      try {
        const result = await fetchToFile(
          item.url ?? '',
          file,
          AbortSignal.any([signal, timeout.signal]),
        );
        if (typeof result === 'string') {
          skipped.push({ path: item.path, reason: result });
          return { staged, skipped };
        }
        bytes = result;
      } finally {
        clearTimeout(timer);
      }
    }
    await file.close();
    file = undefined;
    const verified =
      item.sha256 || item.cacheKey
        ? await fileDigest(temporary, signal)
        : undefined;
    if (item.sha256 && verified?.sha256 !== item.sha256) {
      skipped.push({ path: item.path, reason: 'digest_mismatch' });
      return { staged, skipped };
    }
    signal.throwIfAborted();
    await rename(temporary, abs);
    stageCache.delete(abs);
    if (item.cacheKey && verified) {
      stageCache.set(abs, {
        cacheKey: item.cacheKey,
        sha256: verified.sha256,
      });
      while (stageCache.size > 1024) {
        const oldest = stageCache.keys().next().value;
        if (oldest === undefined) break;
        stageCache.delete(oldest);
      }
    }
    temporary = undefined;
    staged.push({ path: item.path, bytes });
  } catch (err) {
    skipped.push({
      path: item.path,
      reason: callerSignal?.aborted
        ? 'cancelled'
        : err instanceof Error
          ? err.name === 'AbortError'
            ? 'timeout'
            : err.message
          : 'fetch_failed',
    });
  } finally {
    await file?.close();
    if (temporary) await rm(temporary, { force: true });
  }
  return { staged, skipped };
}

async function writeChunk(
  file: FileHandle,
  bytes: Uint8Array,
  signal: AbortSignal,
): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    signal.throwIfAborted();
    const { bytesWritten } = await file.write(
      bytes,
      offset,
      bytes.byteLength - offset,
    );
    if (bytesWritten === 0) throw new Error('file_write_stalled');
    offset += bytesWritten;
  }
}

async function fetchToFile(
  url: string,
  file: FileHandle,
  signal: AbortSignal,
): Promise<number | string> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    await res.body?.cancel();
    return `http_${res.status}`;
  }
  const declared = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > FETCH_MAX_BYTES) {
    await res.body?.cancel();
    return 'too_large';
  }
  if (res.body === null) return 'no_body';
  const reader = res.body.getReader();
  let total = 0;
  const pending: Uint8Array[] = [];
  let pendingBytes = 0;
  const flush = async () => {
    while (pending.length > 0) {
      signal.throwIfAborted();
      const { bytesWritten } = await file.writev(pending);
      if (bytesWritten === 0) throw new Error('file_write_stalled');
      let consumed = bytesWritten;
      while (pending[0] && consumed >= pending[0].byteLength) {
        consumed -= pending[0].byteLength;
        pending.shift();
      }
      if (consumed > 0 && pending[0])
        pending[0] = pending[0].subarray(consumed);
    }
    pendingBytes = 0;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        await flush();
        return total;
      }
      total += value.byteLength;
      if (total > FETCH_MAX_BYTES) return 'too_large';
      pending.push(value);
      pendingBytes += value.byteLength;
      // Bounded scatter/gather batches avoid both a full-payload copy and a
      // filesystem round trip per tiny network chunk. Backpressure resumes
      // after at most 256KiB plus the current transport chunk.
      if (pendingBytes >= 256 * 1024 || pending.length >= 64) await flush();
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
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
