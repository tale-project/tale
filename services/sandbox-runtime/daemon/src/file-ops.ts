// Workspace file operations for runnerd: stage files from presigned URLs,
// list directory entries, read file bytes. All paths are validated to resolve
// under the workspace root (no traversal, no symlink escape) — the same
// boundary the exec cwd check enforces.

import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  lstat,
  open,
  rename,
  type FileHandle,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
} from 'node:fs/promises';
import { basename, join, normalize } from 'node:path';
import { Readable } from 'node:stream';

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
   * `contentBase64` must be set, except a sourceId-only cache probe. */
  url?: string;
  /** Inline bytes, base64. For small control files the platform pushes
   * directly (e.g. mid-turn steer messages) — no URL round-trip. */
  contentBase64?: string;
  /** Trusted immutable source identity; reuse still verifies the actual file. */
  sourceId?: string;
  /** Compatibility alias for callers using the earlier immutable-source field. */
  cacheKey?: string;
  /** Optional content attestation, checked before replacing any destination. */
  sha256?: string;
}

interface StageResult {
  reconciled?: boolean;
  staged: Array<{ path: string; bytes: number }>;
  skipped: Array<{ path: string; reason: string }>;
}

const FETCH_MAX_BYTES = 100 * 1024 * 1024;
const INLINE_MAX_BYTES = 1 * 1024 * 1024;
// One deadline for the whole batch, below the spawner's 30 s RPC timeout.
const STAGE_TIMEOUT_MS = 25_000;
const STAGE_MAX_ACTIVE = 2;
const STAGE_MANIFEST_LIMIT = 4096;
let activeStages = 0;
let reconcilingStage = false;
const stagedSources = new Map<string, { sourceId: string; digest: string }>();

function rememberStagedSource(
  path: string,
  sourceId: string | undefined,
  digest: string,
): void {
  stagedSources.delete(path);
  if (!sourceId) return;
  stagedSources.set(path, { sourceId, digest });
  while (stagedSources.size > STAGE_MANIFEST_LIMIT) {
    const oldest = stagedSources.keys().next().value;
    if (oldest !== undefined) stagedSources.delete(oldest);
  }
}

export interface StageOptions {
  /** Total batch budget, including cached-source verification/reconciliation. */
  fetchTimeoutMs?: number;
  batchTimeoutMs?: number;
  signal?: AbortSignal;
  /** An explicit final reconciliation, sent only after every batch succeeded. */
  replaceRoots?: string[];
  keepPaths?: string[];
}

/** Linux descriptor-relative traversal pins every ancestor while creating or
 * opening its child. The fallback is for host tests; the runtime is Linux. */
function anchoredDirectory(file: FileHandle, path: string): string {
  return process.platform === 'linux' ? `/proc/self/fd/${file.fd}` : path;
}

async function stageParent(
  abs: string,
  createDirectories = true,
): Promise<{ handle: FileHandle; path: string }> {
  const root = await realpath(workspaceRoot());
  const relative = abs.slice(workspaceRoot().length + 1);
  let path = root;
  let handle = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    for (const component of relative.split('/').slice(0, -1)) {
      const anchor = anchoredDirectory(handle, path);
      if ((await realpathUnderRoot(anchor)) === null)
        throw new Error('unsafe_path');
      const childPath = join(anchor, component);
      if (createDirectories) {
        try {
          await mkdir(childPath);
        } catch (error) {
          if (
            !(
              error instanceof Error &&
              'code' in error &&
              error.code === 'EEXIST'
            )
          )
            throw error;
        }
      }
      if ((await lstat(childPath)).isSymbolicLink())
        throw new Error('unsafe_path');
      const child = await open(
        childPath,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      await handle.close();
      handle = child;
      path = join(path, component);
    }
    if ((await realpathUnderRoot(anchoredDirectory(handle, path))) === null)
      throw new Error('unsafe_path');
    return { handle, path };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function fileDigest(
  rel: string,
  signal?: AbortSignal,
): Promise<{ digest: string; bytes: number } | null> {
  let file: FileHandle | undefined;
  let current: FileHandle | undefined;
  try {
    file = (await openWorkspaceFile(rel)) ?? undefined;
    if (file === undefined) return null;
    const info = await file.stat();
    if (!info.isFile() || info.size > FETCH_MAX_BYTES) return null;
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of file.createReadStream({
      signal,
      autoClose: false,
    })) {
      bytes += chunk.length;
      if (bytes > FETCH_MAX_BYTES) return null;
      hash.update(chunk);
    }
    signal?.throwIfAborted();
    // Hashing an old descriptor proves nothing about a replaced destination
    // (or parent directory). Reopen through the current workspace path and
    // require both snapshots to name the same unchanged regular file.
    current = (await openWorkspaceFile(rel)) ?? undefined;
    if (current === undefined) return null;
    const final = await file.stat();
    const actual = await current.stat();
    if (
      [final, actual].some(
        (value) =>
          value.dev !== info.dev ||
          value.ino !== info.ino ||
          value.size !== info.size ||
          value.mtimeMs !== info.mtimeMs ||
          value.ctimeMs !== info.ctimeMs,
      ) ||
      bytes !== info.size
    )
      return null;
    return { digest: hash.digest('hex'), bytes };
  } catch {
    return null;
  } finally {
    await file?.close();
    await current?.close();
  }
}

/** Open through pinned ancestors without following symlinks or waiting on a
 * named pipe. Only regular files may supply bytes to reads or cache probes. */
async function openWorkspaceFile(rel: string): Promise<FileHandle | null> {
  const abs = resolveUnderWorkspace(rel);
  if (abs === null || abs === workspaceRoot()) return null;
  let file: FileHandle | undefined;
  let parentHandle: FileHandle | undefined;
  try {
    const parent = await stageParent(abs, false);
    parentHandle = parent.handle;
    file = await open(
      join(anchoredDirectory(parentHandle, parent.path), basename(abs)),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    if ((await file.stat()).isFile()) return file;
  } catch {
    // Unsafe, missing and unreadable paths cannot supply a verified file.
  } finally {
    await parentHandle?.close().catch(() => {});
  }
  await file?.close().catch(() => {});
  return null;
}

/** Two admitted batches share two transfer slots. One deadline covers queued
 * work, transfer and final reconciliation; individual files publish atomically.
 * Reconciliation is exclusive and runs only after every item succeeded. */
export async function stageFiles(
  items: StageItem[],
  opts: StageOptions = {},
): Promise<StageResult> {
  if (
    activeStages >= STAGE_MAX_ACTIVE ||
    reconcilingStage ||
    (opts.replaceRoots?.length && activeStages > 0)
  ) {
    return {
      staged: [],
      skipped: (items.length
        ? items.map((item) => item.path)
        : (opts.replaceRoots ?? [])
      ).map((path) => ({ path, reason: 'busy' })),
    };
  }
  activeStages += 1;
  if (opts.replaceRoots?.length) reconcilingStage = true;
  const batch = new AbortController();
  const deadline = setTimeout(
    () => batch.abort(),
    opts.batchTimeoutMs ?? opts.fetchTimeoutMs ?? STAGE_TIMEOUT_MS,
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
        outcomes[index] = await stageItem(item, signal, opts);
      } finally {
        release?.();
      }
    }
  };
  try {
    await Promise.all([worker(), worker()]);
    const staged = outcomes.flatMap((result) => result.staged);
    const skipped = outcomes.flatMap((result) => result.skipped);
    if (skipped.length === 0 && opts.replaceRoots?.length) {
      await reconcileStageRoots(
        opts.replaceRoots,
        opts.keepPaths ?? [],
        signal,
        skipped,
        () => (opts.signal?.aborted ? 'cancelled' : 'timeout'),
      );
    }
    return {
      staged,
      skipped,
      ...(opts.replaceRoots?.length && skipped.length === 0
        ? { reconciled: true }
        : {}),
    };
  } finally {
    clearTimeout(deadline);
    batch.abort();
    activeStages -= 1;
    if (opts.replaceRoots?.length) reconcilingStage = false;
  }
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
    if (activeStageTransfers < STAGE_MAX_ACTIVE) start();
    else {
      stageWaiters.push(start);
      signal.addEventListener('abort', aborted, { once: true });
    }
  });
}

async function stageItem(
  item: StageItem,
  batchSignal: AbortSignal,
  opts: StageOptions,
): Promise<StageResult> {
  const staged: StageResult['staged'] = [];
  const skipped: StageResult['skipped'] = [];
  const abs = resolveUnderWorkspace(item.path);
  if (abs === null || abs === workspaceRoot()) {
    return { staged, skipped: [{ path: item.path, reason: 'unsafe_path' }] };
  }
  let temporary: string | undefined;
  let parentHandle: FileHandle | undefined;
  let responseBody: ReadableStream<Uint8Array> | undefined;
  const signal = batchSignal;
  try {
    signal.throwIfAborted();
    const parent = await stageParent(abs);
    parentHandle = parent.handle;
    const anchoredParent = anchoredDirectory(parentHandle, parent.path);
    const destination = join(anchoredParent, basename(abs));
    const sourceId = item.sourceId ?? item.cacheKey;
    const previous = stagedSources.get(abs);
    const expectedDigest =
      item.sha256 ??
      (sourceId && previous?.sourceId === sourceId
        ? previous.digest
        : undefined);
    if (expectedDigest) {
      const actual = await fileDigest(abs, signal);
      if (actual?.digest === expectedDigest) {
        signal.throwIfAborted();
        if (sourceId) rememberStagedSource(abs, sourceId, actual.digest);
        return { staged: [{ path: item.path, bytes: actual.bytes }], skipped };
      }
    }
    let source: Uint8Array | ReadableStream<Uint8Array>;
    if (item.contentBase64 !== undefined) {
      if (item.contentBase64.length > Math.ceil(INLINE_MAX_BYTES / 3) * 4)
        throw new Error('too_large');
      source = Buffer.from(item.contentBase64, 'base64');
      if (source.byteLength > INLINE_MAX_BYTES) throw new Error('too_large');
      const digest = createHash('sha256').update(source).digest('hex');
      if (item.sha256 && item.sha256 !== digest)
        throw new Error('digest_mismatch');
      const actual = await fileDigest(abs, signal);
      if (actual?.digest === digest) {
        signal.throwIfAborted();
        rememberStagedSource(abs, sourceId, digest);
        return { staged: [{ path: item.path, bytes: actual.bytes }], skipped };
      }
    } else if (item.url !== undefined) {
      const response = await fetch(item.url, { signal });
      responseBody = response.body ?? undefined;
      if (!response.ok) throw new Error(`http_${response.status}`);
      const declared = Number(response.headers.get('content-length') ?? '');
      if (Number.isFinite(declared) && declared > FETCH_MAX_BYTES)
        throw new Error('too_large');
      if (response.body === null) throw new Error('no_body');
      source = response.body;
    } else throw new Error('no_source');
    temporary = join(anchoredParent, `.tale-stage-${randomUUID()}`);
    let mode = 0o600;
    try {
      const existing = await lstat(destination);
      if (!existing.isFile()) throw new Error('unsafe_path');
      mode = existing.mode & 0o777;
    } catch (error) {
      if (
        !(error instanceof Error && 'code' in error && error.code === 'ENOENT')
      )
        throw error;
    }
    const file = await open(temporary, 'wx', 0o600);
    const hash = createHash('sha256');
    let bytes = 0;
    try {
      const write = async (chunk: Uint8Array) => {
        signal.throwIfAborted();
        bytes += chunk.byteLength;
        if (bytes > FETCH_MAX_BYTES) throw new Error('too_large');
        hash.update(chunk);
        let offset = 0;
        while (offset < chunk.byteLength) {
          signal.throwIfAborted();
          const result = await file.write(
            chunk,
            offset,
            chunk.byteLength - offset,
          );
          if (result.bytesWritten === 0) throw new Error('file_write_stalled');
          offset += result.bytesWritten;
        }
      };
      if (source instanceof Uint8Array) await write(source);
      else {
        const reader = source.getReader();
        const pending: Uint8Array[] = [];
        let pendingBytes = 0;
        const flush = async () => {
          if (pendingBytes === 0) return;
          const first = pending[0];
          await write(
            pending.length === 1 && first !== undefined
              ? first
              : Buffer.concat(pending, pendingBytes),
          );
          pending.length = 0;
          pendingBytes = 0;
        };
        try {
          for (;;) {
            signal.throwIfAborted();
            const next = await reader.read();
            if (next.done) break;
            if (bytes + pendingBytes + next.value.byteLength > FETCH_MAX_BYTES)
              throw new Error('too_large');
            let offset = 0;
            while (offset < next.value.byteLength) {
              const take = Math.min(
                256 * 1024 - pendingBytes,
                next.value.byteLength - offset,
              );
              pending.push(next.value.subarray(offset, offset + take));
              pendingBytes += take;
              offset += take;
              if (pendingBytes === 256 * 1024) await flush();
            }
          }
          await flush();
        } finally {
          void reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      }
      await file.chmod(mode);
    } finally {
      await file.close();
    }
    const digest = hash.digest('hex');
    if (item.sha256 && item.sha256 !== digest)
      throw new Error('digest_mismatch');
    signal.throwIfAborted();
    if ((await realpathUnderRoot(anchoredParent)) === null)
      throw new Error('unsafe_path');
    await rename(temporary, destination);
    temporary = undefined;
    rememberStagedSource(abs, sourceId, digest);
    staged.push({ path: item.path, bytes });
  } catch (error) {
    skipped.push({
      path: item.path,
      reason: signal.aborted
        ? opts.signal?.aborted
          ? 'cancelled'
          : 'timeout'
        : error instanceof Error
          ? error.message
          : 'fetch_failed',
    });
  } finally {
    // Cancel unread/error bodies without waiting for upstream acknowledgement.
    void responseBody?.cancel().catch(() => {});
    if (temporary !== undefined)
      await rm(temporary, { force: true }).catch(() => {});
    await parentHandle?.close();
  }
  return { staged, skipped };
}

async function reconcileStageRoots(
  roots: string[],
  paths: string[],
  signal: AbortSignal | undefined,
  skipped: StageResult['skipped'],
  abortReason: () => string,
): Promise<void> {
  const invalid = paths.find((path) => resolveUnderWorkspace(path) === null);
  if (invalid !== undefined) {
    skipped.push({ path: invalid, reason: 'unsafe_path' });
    return;
  }
  const keep = new Set(paths.map(resolveUnderWorkspace));
  for (const root of roots) {
    const abs = resolveUnderWorkspace(root);
    if (abs === null || abs === workspaceRoot()) {
      skipped.push({ path: root, reason: 'unsafe_path' });
      continue;
    }
    try {
      try {
        await lstat(abs);
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        )
          continue;
        throw error;
      }
      // Each directory is opened without following links and held while its
      // children are inspected/deleted, just like the staging destination.
      const parent = await stageParent(join(abs, '.check'));
      const walk = async (
        handle: FileHandle,
        directory: string,
      ): Promise<void> => {
        signal?.throwIfAborted();
        const anchor = anchoredDirectory(handle, directory);
        if ((await realpathUnderRoot(anchor)) === null)
          throw new Error('unsafe_path');
        for (const entry of await readdir(anchor, { withFileTypes: true })) {
          const path = join(anchor, entry.name);
          const key = join(directory, entry.name);
          if (entry.isDirectory()) {
            const child = await open(
              path,
              constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
            );
            try {
              await walk(child, key);
            } finally {
              await child.close();
            }
          } else if (!keep.has(key)) {
            signal?.throwIfAborted();
            if ((await realpathUnderRoot(anchor)) === null)
              throw new Error('unsafe_path');
            await rm(path, { force: true });
            stagedSources.delete(key);
          }
        }
      };
      try {
        await walk(parent.handle, abs);
      } finally {
        await parent.handle.close();
      }
    } catch (error) {
      skipped.push({
        path: root,
        reason: signal?.aborted
          ? abortReason()
          : error instanceof Error
            ? error.message
            : 'reconcile_failed',
      });
    }
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
      let parent: Awaited<ReturnType<typeof stageParent>>;
      try {
        parent = await stageParent(abs, false);
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        ) {
          deleted.push(rel);
          continue;
        }
        throw error;
      }
      try {
        await rm(
          join(anchoredDirectory(parent.handle, parent.path), basename(abs)),
          { recursive: true, force: true },
        );
        deleted.push(rel);
      } finally {
        await parent.handle.close();
      }
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
  const out: FsEntry[] = [];
  try {
    // Never traverse a staged root symlink, even to another workspace directory:
    // reconciliation must replace the link, not prune the link target.
    if (!(await lstat(abs)).isDirectory()) return null;
    const canonical = await realpath(abs);
    const root = await realpath(workspaceRoot());
    if (canonical !== root && !canonical.startsWith(`${root}/`)) return null;
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
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error.code === 'ENOENT' || error.code === 'ENOTDIR')
    )
      return null;
    throw error;
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

/** Read a regular file relative to its pinned workspace parent, never a
 * followed symlink. The range is fixed by fstat, so a growing file cannot
 * bypass the byte ceiling. Read traversal never creates directories. */
export async function streamWorkspaceFile(
  rel: string,
  maxBytes: number,
): Promise<Readable | null> {
  let file: FileHandle | undefined;
  try {
    file = (await openWorkspaceFile(rel)) ?? undefined;
    if (file === undefined) return null;
    const info = await file.stat();
    if (!info.isFile() || info.size > maxBytes) {
      await file.close();
      return null;
    }
    if (info.size === 0) {
      await file.close();
      return Readable.from([]);
    }
    return file.createReadStream({
      start: 0,
      end: info.size - 1,
      autoClose: true,
    });
  } catch {
    await file?.close().catch(() => {});
    return null;
  }
}
