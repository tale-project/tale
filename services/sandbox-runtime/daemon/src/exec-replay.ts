// One bounded replay authority: checkpointed segments on disk, with a shared
// physical budget. An unlinked segment stays charged until its last reader
// closes; eviction interrupts stalled readers before reusing their allowance.
import { constants } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  type FileHandle,
} from 'node:fs/promises';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

import {
  isRunnerdExecEvent,
  WORKSPACE_ROOT,
  type RunnerdExecCheckpoint,
} from './protocol.ts';

const SEGMENT_BYTES = 1024 * 1024;
const REPLAY_BYTES = 64 * 1024 * 1024;
const SESSION_BYTES = 256 * 1024 * 1024;
export const REPLAY_WRITE_WATERMARK = 128 * 1024;
const WRITE_VECTORS = 64;
const READ_CHUNK = 64 * 1024;

type ReplayFailure = 'OUTPUT_LIMIT' | 'REPLAY_UNAVAILABLE';
export class ReplayError extends Error {
  constructor(
    readonly code: ReplayFailure,
    message?: string,
  ) {
    super(
      message ??
        (code === 'OUTPUT_LIMIT'
          ? 'Execution output exceeded its replay storage limit.'
          : 'The complete execution transcript is unavailable.'),
    );
  }
}

/** Queued output may already have reached a live reader; later output cannot. */
export function isReplayCursor(since: number, throughSeq: number): boolean {
  return Number.isSafeInteger(since) && since >= 0 && since <= throughSeq;
}

/** Reservation and completed-history eviction share one serialized boundary.
 * Never free accounting merely because a pathname was unlinked. */
export class ReplayBudget {
  private used = 0;
  private readonly completed = new Set<ExecReplay>();
  private readonly closing = new Map<ExecReplay, Promise<void>>();
  private reservation = Promise.resolve();

  constructor(readonly maxBytes = SESSION_BYTES) {}

  async reserve(bytes: number, owner: ExecReplay): Promise<boolean> {
    const previous = this.reservation;
    const turn = Promise.withResolvers<void>();
    this.reservation = turn.promise;
    await previous;
    try {
      while (this.used + bytes > this.maxBytes) {
        const oldest = [...this.completed].find(
          (replay) => replay !== owner && replay.canReclaim,
        );
        if (oldest !== undefined) {
          await oldest.dispose();
          continue;
        }
        const pending = [...this.closing].find(
          ([replay]) => replay !== owner && replay.canReclaim,
        );
        if (pending === undefined) return false;
        await pending[1];
      }
      this.used += bytes;
      return true;
    } finally {
      turn.resolve();
    }
  }

  release(bytes: number): void {
    this.used -= bytes;
  }

  retain(replay: ExecReplay): void {
    this.completed.add(replay);
  }

  retire(replay: ExecReplay, closed: Promise<void>): void {
    this.completed.delete(replay);
    this.closing.set(replay, closed);
    void closed.then(
      () => this.closing.delete(replay),
      () => this.closing.delete(replay),
    );
  }
}

interface Segment {
  path: string;
  first: number;
  last: number;
  bytes: number;
  reserved: number;
  readers: number;
  unlinked: boolean;
  // At most one record-start index entry per read chunk, plus each segment's
  // first record. Checkpoint pruning releases the matching index with it.
  index: { seq: number; position: number }[];
  nextIndex: number;
}

interface AppendBatch {
  records: { bytes: Buffer; seq: number }[];
  bytes: number;
  committed: Promise<void>;
}

export class ExecReplay {
  private readonly directory: Promise<string>;
  private queue: Promise<unknown> = Promise.resolve();
  private pendingAppend: AppendBatch | undefined;
  private readonly segments: Segment[] = [];
  private bytes = 0;
  private nextFile = 0;
  private checkpoint: RunnerdExecCheckpoint | null = null;
  private checkpointBytes = 0;
  private disposed = false;
  private working = false;
  private failure: ReplayError | undefined;
  private writer: FileHandle | undefined;
  private readonly stopped = new AbortController();
  private readonly readers = new Set<Promise<void>>();
  private readonly readHandles = new Set<FileHandle>();
  private disposal: Promise<void> | undefined;
  private readonly pendingIO = new Set<Promise<unknown>>();
  private parentDirectory: FileHandle | undefined;
  private spoolDirectory: FileHandle | undefined;
  private cleanupPath: string | undefined;

  constructor(
    private readonly limits = {
      segmentBytes: SEGMENT_BYTES,
      maxBytes: REPLAY_BYTES,
    },
    private readonly budget = new ReplayBudget(),
    directory?: string,
    private readonly ioTimeoutMs = 5_000,
  ) {
    this.directory = this.io(this.createDirectory(directory));
    void this.directory.catch(() => {
      // The first operation reports the storage failure to its owning exec.
    });
  }

  private async createDirectory(directory?: string): Promise<string> {
    const root = await realpath(
      directory ?? process.env.TALE_WORKSPACE_ROOT ?? WORKSPACE_ROOT,
    );
    const flags =
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
    let parent = await open(root, flags);
    this.parentDirectory = parent;
    let path = root;
    const anchored = () =>
      process.platform === 'linux' ? `/proc/self/fd/${parent.fd}` : path;
    if (directory === undefined) {
      for (const name of ['.runtime', 'tmp']) {
        const childPath = join(anchored(), name);
        await mkdir(childPath, { mode: 0o700 }).catch((error: unknown) => {
          if (
            !(
              error instanceof Error &&
              'code' in error &&
              error.code === 'EEXIST'
            )
          )
            throw error;
        });
        const child = await open(childPath, flags);
        await parent.close();
        parent = child;
        this.parentDirectory = parent;
        path = join(path, name);
      }
    }
    this.cleanupPath = await mkdtemp(join(anchored(), 'tale-replay-'));
    this.spoolDirectory = await open(this.cleanupPath, flags);
    return process.platform === 'linux'
      ? `/proc/self/fd/${this.spoolDirectory.fd}`
      : this.cleanupPath;
  }

  /** A deadline detaches the caller, never the physical I/O owner. Disposal
   * waits for these operations before closing descriptors or releasing bytes. */
  private async io<T>(
    operation: Promise<T>,
    signal?: AbortSignal,
    pending?: Set<Promise<unknown>>,
  ): Promise<T> {
    this.pendingIO.add(operation);
    pending?.add(operation);
    void operation.then(
      () => {
        this.pendingIO.delete(operation);
        pending?.delete(operation);
        return undefined;
      },
      () => {
        this.pendingIO.delete(operation);
        pending?.delete(operation);
        return undefined;
      },
    );
    const interrupted = Promise.withResolvers<never>();
    const abort = () => interrupted.reject(new Error('replay aborted'));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(() => {
      this.failure ??= new ReplayError('REPLAY_UNAVAILABLE');
      interrupted.reject(this.failure);
    }, this.ioTimeoutMs);
    try {
      return await Promise.race([operation, interrupted.promise]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  /** A reservation cannot reclaim a writer waiting on that same reservation. */
  get canReclaim(): boolean {
    return !this.working && this.pendingIO.size === 0;
  }

  assertAvailable(): void {
    if (this.failure) throw this.failure;
    if (this.disposed) throw new ReplayError('REPLAY_UNAVAILABLE');
  }

  private serial<T>(
    work: () => Promise<T>,
    signal?: AbortSignal,
    bounded = true,
  ): Promise<T> {
    if (bounded && (this.disposed || this.failure))
      return Promise.reject(
        this.failure ?? new ReplayError('REPLAY_UNAVAILABLE'),
      );
    // A checkpoint, reader snapshot, finish or disposal is an ordering barrier:
    // a later append must never join a batch queued before that operation.
    this.pendingAppend = undefined;
    const result = this.queue.then(async () => {
      this.working = true;
      try {
        return await work();
      } finally {
        this.working = false;
      }
    });
    this.queue = result.catch(() => {
      // The operation caller receives the error; later cleanup must still run.
    });
    return bounded ? this.io(result, signal) : result;
  }

  append(line: string, seq: number): Promise<void> {
    if (this.disposed || this.failure)
      return Promise.reject(
        this.failure ?? new ReplayError('REPLAY_UNAVAILABLE'),
      );
    const bytes = Buffer.from(line);
    const pending = this.pendingAppend;
    if (
      pending &&
      pending.records.length < WRITE_VECTORS &&
      pending.bytes + bytes.length <= REPLAY_WRITE_WATERMARK
    ) {
      pending.records.push({ bytes, seq });
      pending.bytes += bytes.length;
      return pending.committed;
    }
    const batch: AppendBatch = {
      records: [{ bytes, seq }],
      bytes: bytes.length,
      committed: Promise.resolve(),
    };
    batch.committed = this.serial(async () => {
      if (this.pendingAppend === batch) this.pendingAppend = undefined;
      await this.writeBatch(batch);
    });
    this.pendingAppend = batch;
    return batch.committed;
  }

  private async writeBatch(batch: AppendBatch): Promise<void> {
    this.assertAvailable();
    try {
      await this.prune();
      if (this.bytes + batch.bytes > this.limits.maxBytes)
        throw new ReplayError('OUTPUT_LIMIT');
      for (let start = 0; start < batch.records.length;) {
        this.assertAvailable();
        const first = batch.records[start];
        if (!first) break;
        let segment = this.segments.at(-1);
        if (!segment || segment.bytes >= this.limits.segmentBytes) {
          segment = {
            path: join(await this.directory, `${this.nextFile++}.ndjson`),
            first: first.seq,
            last: first.seq,
            bytes: 0,
            reserved: 0,
            readers: 0,
            unlinked: false,
            index: [],
            nextIndex: 0,
          };
          await this.writer?.close();
          await this.io(
            open(segment.path, 'ax', 0o600).then((file) => {
              this.writer = file;
              return undefined;
            }),
          );
          this.segments.push(segment);
        }
        if (!this.writer) throw new ReplayError('REPLAY_UNAVAILABLE');
        let end = start;
        let bytes = 0;
        while (end < batch.records.length) {
          const record = batch.records[end];
          if (!record) break;
          bytes += record.bytes.length;
          end += 1;
          if (segment.bytes + bytes >= this.limits.segmentBytes) break;
        }
        if (!(await this.budget.reserve(bytes, this)))
          throw new ReplayError('OUTPUT_LIMIT');
        segment.reserved += bytes;
        const records = batch.records.slice(start, end);
        let buffers = records.map((record) => record.bytes);
        // writev can stop inside a record. Publish neither its sequence nor
        // sparse index until every byte in this bounded group is committed.
        while (buffers.length > 0) {
          this.assertAvailable();
          const { bytesWritten } = await this.io(this.writer.writev(buffers));
          if (bytesWritten === 0) throw new ReplayError('REPLAY_UNAVAILABLE');
          let remaining = bytesWritten;
          let written = 0;
          while (written < buffers.length) {
            const buffer = buffers[written];
            if (!buffer || remaining < buffer.length) break;
            remaining -= buffer.length;
            written += 1;
          }
          buffers = buffers.slice(written);
          const partial = buffers[0];
          if (remaining > 0 && partial)
            buffers[0] = partial.subarray(remaining);
        }
        for (const record of records) {
          if (segment.bytes >= segment.nextIndex) {
            segment.index.push({ seq: record.seq, position: segment.bytes });
            segment.nextIndex = segment.bytes + READ_CHUNK;
          }
          segment.bytes += record.bytes.length;
          segment.last = record.seq;
        }
        this.bytes += bytes;
        start = end;
      }
    } catch (error) {
      this.failure =
        error instanceof ReplayError
          ? error
          : new ReplayError('REPLAY_UNAVAILABLE');
      throw this.failure;
    }
  }

  private releaseSegment(segment: Segment): void {
    if (segment.unlinked && segment.readers === 0 && segment.reserved > 0) {
      this.budget.release(segment.reserved);
      segment.reserved = 0;
    }
  }

  private async prune(): Promise<void> {
    while (this.segments.length > 0) {
      const first = this.segments[0];
      if (!first || first.last > (this.checkpoint?.seq ?? -1)) break;
      if (this.segments.length === 1) {
        await this.writer?.close();
        this.writer = undefined;
      }
      await rm(first.path, { force: true });
      first.unlinked = true;
      this.segments.shift();
      this.bytes -= first.bytes;
      this.releaseSegment(first);
    }
  }

  getCheckpoint(): Promise<RunnerdExecCheckpoint | null> {
    return this.serial(async () => {
      this.assertAvailable();
      if (this.checkpoint === null) return null;
      const value: unknown = JSON.parse(
        await readFile(join(await this.directory, 'checkpoint.json'), 'utf8'),
      );
      if (
        value === null ||
        typeof value !== 'object' ||
        !('seq' in value) ||
        typeof value.seq !== 'number' ||
        !('state' in value)
      )
        throw new ReplayError('REPLAY_UNAVAILABLE');
      return { seq: value.seq, state: value.state };
    });
  }

  saveCheckpoint(checkpoint: RunnerdExecCheckpoint): Promise<boolean> {
    return this.serial(async () => {
      this.assertAvailable();
      if (checkpoint.seq < (this.checkpoint?.seq ?? -1)) return false;
      const root = await this.directory;
      const temporary = join(root, 'checkpoint.tmp');
      const encoded = JSON.stringify(checkpoint);
      const bytes = Buffer.byteLength(encoded);
      if (!(await this.budget.reserve(bytes, this)))
        throw new ReplayError('OUTPUT_LIMIT');
      let committed = false;
      try {
        const file = await open(temporary, 'w', 0o600);
        try {
          await file.writeFile(encoded);
          await file.sync();
        } finally {
          await file.close();
        }
        await rename(temporary, join(root, 'checkpoint.json'));
        this.budget.release(this.checkpointBytes);
        this.checkpointBytes = bytes;
        committed = true;
        const directory = await open(root, 'r');
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
        this.checkpoint = checkpoint;
        await this.prune();
        return true;
      } catch {
        // Rename may already have exposed a newer checkpoint before a failed
        // directory sync. Never let the old in-memory cursor authorize a
        // stale overwrite, or prune output against an uncertain commit.
        this.failure = new ReplayError('REPLAY_UNAVAILABLE');
        throw this.failure;
      } finally {
        if (!committed) {
          await rm(temporary, { force: true });
          this.budget.release(bytes);
        }
      }
    });
  }

  /** Open the bounded snapshot under the writer queue. Checkpoints can unlink
   * its segments safely; leases retain both handles and physical accounting. */
  async replay(
    since: number,
    until: number,
    line: (value: string) => Promise<void>,
    gap: (from: number, to: number) => void,
    signal?: AbortSignal,
  ): Promise<number> {
    this.assertAvailable();
    if (signal?.aborted) return since;
    if (!isReplayCursor(since, until))
      throw new ReplayError(
        'REPLAY_UNAVAILABLE',
        'Invalid execution replay cursor.',
      );
    const combined = signal
      ? AbortSignal.any([signal, this.stopped.signal])
      : this.stopped.signal;
    if (since === until) {
      // Empty suffixes still cross the captured commit boundary. A cursor
      // cannot acknowledge a pending write that may yet fail.
      try {
        await this.serial(async () => this.assertAvailable(), combined);
      } catch (error) {
        if (!combined.aborted) throw error;
      }
      return since;
    }
    const done = Promise.withResolvers<void>();
    this.readers.add(done.promise);
    const snapshot: Array<{
      segment: Segment;
      bytes: number;
      last: number;
      file?: FileHandle;
    }> = [];
    let cursor = since;
    const pendingIO = new Set<Promise<unknown>>();
    try {
      await this.serial(async () => {
        this.assertAvailable();
        for (const segment of this.segments) {
          if (
            segment.last <= since ||
            segment.first > until ||
            combined.aborted
          )
            continue;
          // Pin the physical reservation before open enters the kernel. An
          // abort may release the queue while that open is still pending.
          const lease: (typeof snapshot)[number] = {
            segment,
            bytes: segment.bytes,
            last: segment.last,
          };
          segment.readers += 1;
          snapshot.push(lease);
          await this.io(
            open(segment.path, 'r').then((file) => {
              this.readHandles.add(file);
              lease.file = file;
              return undefined;
            }),
            combined,
            pendingIO,
          );
        }
      }, combined);
      for (const { segment, bytes, last, file } of snapshot) {
        if (combined.aborted) return cursor;
        if (!file) throw new ReplayError('REPLAY_UNAVAILABLE');
        if (segment.first > cursor + 1) {
          if ((this.checkpoint?.seq ?? -1) < segment.first - 1)
            throw new ReplayError('REPLAY_UNAVAILABLE');
          gap(cursor + 1, segment.first - 1);
          return cursor;
        }
        const buffer = Buffer.alloc(READ_CHUNK);
        const decoder = new StringDecoder('utf8');
        let low = 0;
        let high = segment.index.length;
        while (low < high) {
          const middle = Math.floor((low + high) / 2);
          const entry = segment.index[middle];
          if (entry && entry.seq <= cursor + 1) low = middle + 1;
          else high = middle;
        }
        const checkpoint = segment.index[low - 1];
        let offset = checkpoint?.position ?? 0;
        let seenSeq = (checkpoint?.seq ?? segment.first) - 1;
        let pending = '';
        while (offset < bytes) {
          if (combined.aborted) return cursor;
          const { bytesRead } = await this.io(
            file.read(
              buffer,
              0,
              Math.min(buffer.length, bytes - offset),
              offset,
            ),
            combined,
            pendingIO,
          );
          if (bytesRead === 0) throw new ReplayError('REPLAY_UNAVAILABLE');
          offset += bytesRead;
          pending += decoder.write(buffer.subarray(0, bytesRead));
          let end: number;
          while ((end = pending.indexOf('\n')) !== -1) {
            const item = pending.slice(0, end);
            pending = pending.slice(end + 1);
            const event: unknown = JSON.parse(item);
            if (
              !isRunnerdExecEvent(event) ||
              event.seq === undefined ||
              event.seq !== seenSeq + 1
            )
              throw new ReplayError('REPLAY_UNAVAILABLE');
            seenSeq = event.seq;
            if (event.seq <= cursor) continue;
            if (event.seq > until || combined.aborted) return cursor;
            if (event.seq !== cursor + 1)
              throw new ReplayError('REPLAY_UNAVAILABLE');
            await deliver(line, item, combined);
            cursor = event.seq;
          }
        }
        if (pending.length > 0 || seenSeq !== last)
          throw new ReplayError('REPLAY_UNAVAILABLE');
      }
      if (cursor < until && !combined.aborted) {
        if ((this.checkpoint?.seq ?? -1) < until)
          throw new ReplayError('REPLAY_UNAVAILABLE');
        gap(cursor + 1, until);
      }
      return cursor;
    } catch (error) {
      if (combined.aborted) return cursor;
      this.failure =
        error instanceof ReplayError
          ? error
          : new ReplayError('REPLAY_UNAVAILABLE');
      throw this.failure;
    } finally {
      const close = async () => {
        try {
          await Promise.allSettled(pendingIO);
          await Promise.all(
            snapshot.map(async ({ segment, file }) => {
              await file?.close();
              if (file) this.readHandles.delete(file);
              segment.readers -= 1;
              this.releaseSegment(segment);
            }),
          );
        } finally {
          this.readers.delete(done.promise);
          done.resolve();
        }
      };
      // A cancelled or timed-out reader is detached promptly. Its lease and
      // reservation survive in this cleanup until the real read has settled.
      if (pendingIO.size > 0)
        void close().catch(() => {
          /* Failed closes keep their physical charge. */
        });
      else await close();
    }
  }

  finish(): Promise<void> {
    return this.serial(async () => {
      this.assertAvailable();
      await this.writer?.close();
      this.writer = undefined;
      if (!this.disposed) this.budget.retain(this);
    });
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposed = true;
    this.stopped.abort();
    this.disposal = (async () => {
      await this.serial(
        async () => {
          // A deferred descendant may keep this spool object reachable after
          // eviction. The parser snapshot is no longer usable or owned here.
          this.checkpoint = null;
          await Promise.allSettled(this.pendingIO);
          await this.writer?.close();
          this.writer = undefined;
          if (this.cleanupPath)
            await rm(this.cleanupPath, { recursive: true, force: true });
          await this.spoolDirectory?.close();
          await this.parentDirectory?.close();
          for (const segment of this.segments) {
            segment.unlinked = true;
            this.releaseSegment(segment);
          }
          this.segments.length = 0;
          this.bytes = 0;
          this.budget.release(this.checkpointBytes);
          this.checkpointBytes = 0;
        },
        undefined,
        false,
      );
      await Promise.all(this.readers);
    })();
    this.budget.retire(this, this.disposal);
    return this.disposal;
  }
}

/** One removable abort waiter per event, not a retained reaction per record
 * against a never-settled global cancellation promise. */
async function deliver(
  line: (value: string) => Promise<void>,
  value: string,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return;
  const stopped = Promise.withResolvers<void>();
  const abort = () => stopped.resolve();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  try {
    await Promise.race([line(value), stopped.promise]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
