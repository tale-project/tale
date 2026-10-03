// One bounded replay authority: checkpointed segments on disk, with a shared
// physical budget. An unlinked segment stays charged until its last reader
// closes; eviction interrupts stalled readers before reusing their allowance.
import {
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  type FileHandle,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

import type { RunnerdExecCheckpoint } from './protocol.ts';

const SEGMENT_BYTES = 1024 * 1024;
const REPLAY_BYTES = 64 * 1024 * 1024;
const SESSION_BYTES = 256 * 1024 * 1024;

type ReplayFailure = 'OUTPUT_LIMIT' | 'REPLAY_UNAVAILABLE';
export class ReplayError extends Error {
  constructor(readonly code: ReplayFailure) {
    super(
      code === 'OUTPUT_LIMIT'
        ? 'Execution output exceeded its replay storage limit.'
        : 'The complete execution transcript is unavailable.',
    );
  }
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
}

export class ExecReplay {
  private readonly directory: Promise<string>;
  private queue: Promise<unknown> = Promise.resolve();
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

  constructor(
    private readonly limits = {
      segmentBytes: SEGMENT_BYTES,
      maxBytes: REPLAY_BYTES,
    },
    private readonly budget = new ReplayBudget(),
    directory = tmpdir(),
  ) {
    this.directory = mkdtemp(join(directory, 'tale-replay-'));
    void this.directory.catch(() => {
      // The first operation reports the storage failure to its owning exec.
    });
  }

  /** A reservation cannot reclaim a writer waiting on that same reservation. */
  get canReclaim(): boolean {
    return !this.working;
  }

  assertAvailable(): void {
    if (this.failure) throw this.failure;
    if (this.disposed) throw new ReplayError('REPLAY_UNAVAILABLE');
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
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
    return result;
  }

  append(line: string, seq: number): Promise<void> {
    return this.serial(async () => {
      this.assertAvailable();
      try {
        const bytes = Buffer.byteLength(line);
        await this.prune();
        if (this.bytes + bytes > this.limits.maxBytes)
          throw new ReplayError('OUTPUT_LIMIT');
        let segment = this.segments.at(-1);
        if (!segment || segment.bytes >= this.limits.segmentBytes) {
          segment = {
            path: join(await this.directory, `${this.nextFile++}.ndjson`),
            first: seq,
            last: seq,
            bytes: 0,
            reserved: 0,
            readers: 0,
            unlinked: false,
          };
          await this.writer?.close();
          this.writer = await open(segment.path, 'ax', 0o600);
          this.segments.push(segment);
        }
        if (!this.writer) throw new ReplayError('REPLAY_UNAVAILABLE');
        if (!(await this.budget.reserve(bytes, this)))
          throw new ReplayError('OUTPUT_LIMIT');
        segment.reserved += bytes;
        await this.writer.writeFile(line);
        segment.bytes += bytes;
        segment.last = seq;
        this.bytes += bytes;
      } catch (error) {
        this.failure =
          error instanceof ReplayError
            ? error
            : new ReplayError('REPLAY_UNAVAILABLE');
        throw this.failure;
      }
    });
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
    if (signal?.aborted || since >= until) return since;
    const combined = signal
      ? AbortSignal.any([signal, this.stopped.signal])
      : this.stopped.signal;
    const done = Promise.withResolvers<void>();
    this.readers.add(done.promise);
    const snapshot: Array<{
      segment: Segment;
      bytes: number;
      file: FileHandle;
    }> = [];
    let cursor = since;
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
          const file = await open(segment.path, 'r');
          this.readHandles.add(file);
          segment.readers += 1;
          snapshot.push({ segment, bytes: segment.bytes, file });
        }
      });
      for (const { segment, bytes, file } of snapshot) {
        if (combined.aborted) return cursor;
        if (segment.first > cursor + 1) {
          gap(cursor + 1, segment.first - 1);
          return cursor;
        }
        const buffer = Buffer.alloc(64 * 1024);
        const decoder = new StringDecoder('utf8');
        let offset = 0;
        let pending = '';
        while (offset < bytes) {
          if (combined.aborted) return cursor;
          const { bytesRead } = await file.read(
            buffer,
            0,
            Math.min(buffer.length, bytes - offset),
            offset,
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
              event === null ||
              typeof event !== 'object' ||
              !('seq' in event) ||
              typeof event.seq !== 'number'
            )
              throw new ReplayError('REPLAY_UNAVAILABLE');
            if (event.seq <= cursor) continue;
            if (event.seq > until || combined.aborted) return cursor;
            if (event.seq !== cursor + 1) {
              gap(cursor + 1, event.seq - 1);
              return cursor;
            }
            await deliver(line, item, combined);
            cursor = event.seq;
          }
        }
      }
      if (cursor < until && !combined.aborted) gap(cursor + 1, until);
      return cursor;
    } finally {
      try {
        await Promise.all(
          snapshot.map(async ({ segment, file }) => {
            await file.close();
            this.readHandles.delete(file);
            segment.readers -= 1;
            this.releaseSegment(segment);
          }),
        );
      } finally {
        // A failed close keeps its bytes charged, but must not wedge every
        // other writer waiting for this reader's disposal to settle.
        this.readers.delete(done.promise);
        done.resolve();
      }
    }
  }

  finish(): Promise<void> {
    return this.serial(async () => {
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
      await this.serial(async () => {
        // A deferred descendant may keep this spool object reachable after
        // eviction. The parser snapshot is no longer usable or owned here.
        this.checkpoint = null;
        await this.writer?.close();
        this.writer = undefined;
        await rm(await this.directory, { recursive: true, force: true });
        for (const segment of this.segments) {
          segment.unlinked = true;
          this.releaseSegment(segment);
        }
        this.segments.length = 0;
        this.bytes = 0;
        this.budget.release(this.checkpointBytes);
        this.checkpointBytes = 0;
      });
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
