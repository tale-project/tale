// Full exec protocol, bounded on disk instead of treating the diagnostic ring
// as authoritative history. Files are unlinked after open: only runnerd's fd
// names them, and a container restart leaves no stale transcripts on disk.
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  mkdir,
  open,
  realpath,
  unlink,
  type FileHandle,
} from 'node:fs/promises';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

import { WORKSPACE_ROOT, type RunnerdExecEvent } from './protocol.ts';

const EXEC_BYTES = 64 * 1024 * 1024;
const SESSION_BYTES = 256 * 1024 * 1024;
const WRITE_WATERMARK = 128 * 1024;
const READ_CHUNK = 64 * 1024;

type Failure = 'OUTPUT_LIMIT' | 'REPLAY_UNAVAILABLE' | 'OUTPUT_GAP';

/** Shared by a session's live and retained execs. Completed history goes first
 * under pressure; an evicted transcript fails replay explicitly. */
export class JournalBudget {
  private used = 0;
  private readonly completed = new Set<ExecJournal>();
  private readonly closing = new Map<ExecJournal, Promise<void>>();
  private reservation = Promise.resolve();

  constructor(readonly maxBytes = SESSION_BYTES) {}

  /** Serialize reservation/eviction at the write boundary. A new writer
   * waits for the old descriptor to close before reusing its disk allowance. */
  async reserve(bytes: number): Promise<boolean> {
    const previous = this.reservation;
    const turn = Promise.withResolvers<void>();
    this.reservation = turn.promise;
    await previous;
    try {
      while (this.used + bytes > this.maxBytes) {
        const oldest = [...this.completed].find(
          (journal) => journal.canReclaim,
        );
        if (oldest !== undefined) {
          await oldest.dispose();
          continue;
        }
        // Disposal outside reserve (retention cap or manager shutdown) can
        // already be closing an idle descriptor. Await that same ownership.
        const pending = [...this.closing].find(
          ([journal]) => journal.canReclaim,
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

  retain(journal: ExecJournal): void {
    this.completed.add(journal);
  }

  retire(journal: ExecJournal, closed: Promise<void>): void {
    this.completed.delete(journal);
    this.closing.set(journal, closed);
    void closed.then(() => this.closing.delete(journal));
  }
}

export class ExecJournal {
  private readonly ready: Promise<FileHandle>;
  private queued: Buffer[] = [];
  private queuedBytes = 0;
  private totalBytes = 0;
  private committedBytes = 0;
  private reservedBytes = 0;
  private writing = false;
  private complete = false;
  private lastSeq = 0;
  private disposed = false;
  private failure: Failure | undefined;
  private readers = 0;
  private closed = false;
  private pendingReads = 0;
  private writeDeadline: ReturnType<typeof setTimeout> | undefined;
  private readonly waiters = new Set<() => void>();
  private readonly disposeWaiters = new Set<() => void>();
  private readonly released = Promise.withResolvers<void>();

  constructor(
    private readonly budget: JournalBudget,
    private readonly onDrain: () => void,
    private readonly onFailure: (failure: Failure) => void,
    private readonly maxBytes = EXEC_BYTES,
    directory?: string,
    private readonly ioTimeoutMs = 5_000,
  ) {
    this.ready = this.openFile(directory);
    void this.ready.catch(() => this.fail('REPLAY_UNAVAILABLE'));
  }

  private async openFile(directory?: string): Promise<FileHandle> {
    // /tmp is a small tmpfs in production. Keep anonymous transcript bytes on
    // the workspace volume, and hold each directory while descending so a
    // workspace symlink swap cannot redirect creation outside the session.
    const root = await realpath(
      directory ?? process.env.TALE_WORKSPACE_ROOT ?? WORKSPACE_ROOT,
    );
    let parent = await open(
      root,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    let path = root;
    try {
      if (directory === undefined) {
        for (const name of ['.runtime', 'tmp']) {
          const anchor =
            process.platform === 'linux' ? `/proc/self/fd/${parent.fd}` : path;
          const childPath = join(anchor, name);
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
          const child = await open(
            childPath,
            constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
          );
          await parent.close();
          parent = child;
          path = join(path, name);
        }
      }
      const anchor =
        process.platform === 'linux' ? `/proc/self/fd/${parent.fd}` : path;
      const filename = join(anchor, `runnerd-journal-${randomUUID()}`);
      const file = await open(filename, 'wx+', 0o600);
      try {
        await unlink(filename);
      } catch (error) {
        await file.close();
        throw error;
      }
      return file;
    } finally {
      await parent.close();
    }
  }

  private armWriteDeadline(): void {
    clearTimeout(this.writeDeadline);
    this.writeDeadline = setTimeout(
      () => this.fail('REPLAY_UNAVAILABLE'),
      this.ioTimeoutMs,
    );
    this.writeDeadline.unref();
  }

  /** Abort/timeout detaches a reader promptly, but never releases the actual
   * file or its disk reservation until the kernel operation has settled. */
  private async readIO<T>(
    operation: Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    this.pendingReads += 1;
    void operation
      .finally(() => {
        this.pendingReads -= 1;
        this.closeIfUnused();
      })
      .catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort = () => {};
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          abort = () => reject(new Error('replay aborted'));
          timer = setTimeout(() => {
            this.fail('REPLAY_UNAVAILABLE');
            reject(new Error('replay I/O stalled'));
          }, this.ioTimeoutMs);
          signal?.addEventListener('abort', abort, { once: true });
          if (signal?.aborted) abort();
        }),
      ]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  /** false asks the child pipes to pause; onDrain resumes them. */
  append(line: string): boolean {
    if (this.failure !== undefined || this.disposed) return false;
    const bytes = Buffer.byteLength(line);
    if (this.totalBytes + bytes > this.maxBytes) {
      this.fail('OUTPUT_LIMIT');
      return false;
    }
    this.lastSeq += 1;
    this.totalBytes += bytes;
    this.queuedBytes += bytes;
    this.queued.push(Buffer.from(line));
    void this.flush();
    return this.queuedBytes < WRITE_WATERMARK;
  }

  async drain(): Promise<void> {
    while (
      (this.writing || this.queued.length > 0) &&
      this.failure === undefined &&
      !this.disposed
    )
      await this.changed();
  }

  finish(): void {
    this.complete = true;
    this.budget.retain(this);
    this.wake();
  }

  /** A journal whose writer awaits reservation cannot be reclaimed by that
   * reservation: doing so would wait on itself. Normal completion drains first. */
  get canReclaim(): boolean {
    return !this.writing;
  }

  dispose(): Promise<void> {
    if (this.disposed) return this.released.promise;
    this.disposed = true;
    this.budget.retire(this, this.released.promise);
    this.queued = [];
    for (const wake of this.disposeWaiters) wake();
    this.disposeWaiters.clear();
    this.wake();
    this.closeIfUnused();
    return this.released.promise;
  }

  /** A detached or evicted replay must not keep its journal alive while an
   * arbitrary consumer callback waits on a socket. Remove each waiter after
   * its event; racing every event against one pending promise would itself
   * retain one promise reaction per historical record. */
  private async deliver(
    emit: (event: RunnerdExecEvent) => void | Promise<void>,
    event: RunnerdExecEvent,
    signal?: AbortSignal,
  ): Promise<void> {
    const delivered = emit(event);
    if (delivered === undefined) return;
    const stopped = Promise.withResolvers<void>();
    const stop = () => stopped.resolve();
    this.disposeWaiters.add(stop);
    signal?.addEventListener('abort', stop, { once: true });
    if (this.disposed || signal?.aborted) stop();
    try {
      await Promise.race([delivered, stopped.promise]);
    } finally {
      this.disposeWaiters.delete(stop);
      signal?.removeEventListener('abort', stop);
    }
  }

  private fail(failure: Failure): void {
    if (this.failure !== undefined || this.disposed) return;
    this.failure = failure;
    this.queued = [];
    this.onFailure(failure);
    this.wake();
  }

  private async flush(): Promise<void> {
    if (this.writing || this.disposed || this.failure !== undefined) return;
    this.writing = true;
    this.armWriteDeadline();
    try {
      const file = await this.ready;
      while (
        this.queued.length &&
        !this.disposed &&
        this.failure === undefined
      ) {
        const batch = this.queued;
        this.queued = [];
        for (const bytes of batch) {
          if (this.disposed || this.failure !== undefined) break;
          if (!(await this.budget.reserve(bytes.length))) {
            this.fail('OUTPUT_LIMIT');
            break;
          }
          this.reservedBytes += bytes.length;
          if (this.disposed || this.failure !== undefined) break;
          let offset = 0;
          while (offset < bytes.length) {
            const written = await file.write(
              bytes,
              offset,
              bytes.length - offset,
              this.committedBytes,
            );
            if (written.bytesWritten === 0)
              throw new Error('journal write made no progress');
            this.armWriteDeadline();
            offset += written.bytesWritten;
            this.committedBytes += written.bytesWritten;
          }
          this.queuedBytes -= bytes.length;
        }
        this.wake();
        if (this.queuedBytes < WRITE_WATERMARK) this.onDrain();
      }
    } catch {
      this.fail('REPLAY_UNAVAILABLE');
    } finally {
      clearTimeout(this.writeDeadline);
      this.writeDeadline = undefined;
      this.writing = false;
      this.wake();
      this.closeIfUnused();
    }
  }

  private wake(): void {
    for (const wake of this.waiters) wake();
    this.waiters.clear();
  }

  private changed(signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        signal?.removeEventListener('abort', done);
        this.waiters.delete(done);
        resolve();
      };
      this.waiters.add(done);
      signal?.addEventListener('abort', done, { once: true });
      if (signal?.aborted) done();
    });
  }

  async replay(
    emit: (event: RunnerdExecEvent) => void | Promise<void>,
    sinceSeq: number,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) return;
    let seenSeq = 0;
    let caughtUp = false;
    this.readers += 1;
    try {
      // Capability and ordering are one stream: consumers must wait for the
      // matching replay-complete before interpreting historical turn results.
      await this.deliver(emit, { t: 'replay-start' }, signal);
      if (signal?.aborted) return;
      if (
        !Number.isSafeInteger(sinceSeq) ||
        sinceSeq < 0 ||
        sinceSeq > this.lastSeq
      ) {
        await this.deliver(
          emit,
          {
            t: 'fail',
            code: 'OUTPUT_GAP',
            message: 'The replay cursor is outside the available transcript.',
          },
          signal,
        );
        return;
      }
      const file = await this.readIO(this.ready, signal);
      const buffer = Buffer.alloc(READ_CHUNK);
      let position = 0;
      let pending = '';
      const decoder = new StringDecoder('utf8');
      for (;;) {
        if (signal?.aborted) return;
        if (this.failure !== undefined || this.disposed) {
          await this.deliver(
            emit,
            {
              t: 'fail',
              code: this.failure ?? 'REPLAY_UNAVAILABLE',
              message: 'The complete execution transcript is unavailable.',
            },
            signal,
          );
          return;
        }
        if (position < this.committedBytes) {
          const { bytesRead } = await this.readIO(
            file.read(
              buffer,
              0,
              Math.min(buffer.length, this.committedBytes - position),
              position,
            ),
            signal,
          );
          if (bytesRead === 0) throw new Error('incomplete journal');
          position += bytesRead;
          pending += decoder.write(buffer.subarray(0, bytesRead));
          for (
            let end = pending.indexOf('\n');
            end !== -1;
            end = pending.indexOf('\n')
          ) {
            const line = pending.slice(0, end);
            pending = pending.slice(end + 1);
            const event: unknown = JSON.parse(line);
            if (!isRunnerdExecEvent(event) || event.seq !== seenSeq + 1)
              throw new Error('invalid journal event sequence');
            seenSeq = event.seq;
            if (
              !caughtUp &&
              event.t === 'exit' &&
              seenSeq === this.lastSeq &&
              !signal?.aborted
            ) {
              caughtUp = true;
              await this.deliver(
                emit,
                { t: 'replay-complete', throughSeq: seenSeq },
                signal,
              );
            }
            if ((event.seq ?? 0) > sinceSeq && !signal?.aborted)
              await this.deliver(emit, event, signal);
            if (!caughtUp && seenSeq === this.lastSeq && !signal?.aborted) {
              caughtUp = true;
              await this.deliver(
                emit,
                { t: 'replay-complete', throughSeq: seenSeq },
                signal,
              );
            }
          }
          continue;
        }
        if (!caughtUp && seenSeq === this.lastSeq && !signal?.aborted) {
          caughtUp = true;
          await this.deliver(
            emit,
            { t: 'replay-complete', throughSeq: seenSeq },
            signal,
          );
          continue;
        }
        if (this.complete && !this.writing && this.queued.length === 0) return;
        await this.changed(signal);
      }
    } catch {
      if (!signal?.aborted)
        await this.deliver(
          emit,
          {
            t: 'fail',
            code: 'REPLAY_UNAVAILABLE',
            message: 'The complete execution transcript could not be read.',
          },
          signal,
        );
    } finally {
      this.readers -= 1;
      this.closeIfUnused();
    }
  }

  private closeIfUnused(): void {
    if (
      !this.disposed ||
      this.writing ||
      this.readers > 0 ||
      this.pendingReads > 0 ||
      this.closed
    )
      return;
    this.closed = true;
    void this.ready
      .then((file) => file.close())
      .then(() => {
        this.budget.release(this.reservedBytes);
        this.reservedBytes = 0;
        return undefined;
      })
      // Failed close does not make its storage available to another writer.
      .catch(() => {})
      .finally(() => this.released.resolve());
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Narrow a recorded protocol line to a RunnerdExecEvent. Lines are produced by
 * ringEmit (JSON.stringify of our own union), so this is defence-in-depth, but
 * it keeps the replay path cast-free: validate the `t` discriminator + the
 * required per-variant fields before emitting. */
function isRunnerdExecEvent(v: unknown): v is RunnerdExecEvent {
  if (!isObject(v)) return false;
  if (v.seq !== undefined && typeof v.seq !== 'number') return false;
  switch (v.t) {
    case 'start':
      return typeof v.execId === 'string' && typeof v.startedAtMs === 'number';
    case 'stdout':
    case 'stderr':
      return typeof v.b64 === 'string';
    case 'exit':
      return (
        typeof v.exitCode === 'number' &&
        typeof v.durationMs === 'number' &&
        typeof v.timedOut === 'boolean' &&
        typeof v.cancelled === 'boolean' &&
        isObject(v.truncated)
      );
    case 'fail':
      return typeof v.code === 'string' && typeof v.message === 'string';
    default:
      return false;
  }
}
