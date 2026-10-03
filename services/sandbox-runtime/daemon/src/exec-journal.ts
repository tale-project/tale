// Full exec protocol, bounded on disk instead of treating the diagnostic ring
// as authoritative history. Files are unlinked after open: only runnerd's fd
// names them, and a container restart leaves no stale transcripts on disk.
import {
  mkdtemp,
  open,
  rmdir,
  unlink,
  type FileHandle,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

import { isRunnerdExecEvent, type RunnerdExecEvent } from './protocol.ts';

const EXEC_BYTES = 64 * 1024 * 1024;
const SESSION_BYTES = 256 * 1024 * 1024;
const WRITE_WATERMARK = 128 * 1024;
const READ_CHUNK = 64 * 1024;

type Failure = 'OUTPUT_LIMIT' | 'REPLAY_UNAVAILABLE';

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
  private readonly waiters = new Set<() => void>();
  private readonly disposeWaiters = new Set<() => void>();
  private readonly released = Promise.withResolvers<void>();

  constructor(
    private readonly budget: JournalBudget,
    private readonly onDrain: () => void,
    private readonly onFailure: (failure: Failure) => void,
    private readonly maxBytes = EXEC_BYTES,
    directory = tmpdir(),
  ) {
    this.ready = this.openFile(directory);
    void this.ready.catch(() => this.fail('REPLAY_UNAVAILABLE'));
  }

  private async openFile(directory: string): Promise<FileHandle> {
    const root = await mkdtemp(join(directory, 'tale-exec-'));
    const path = join(root, 'events');
    try {
      const file = await open(path, 'wx+', 0o600);
      try {
        await unlink(path);
      } catch (error) {
        await file.close();
        throw error;
      }
      return file;
    } finally {
      await rmdir(root);
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
    const throughSeq = this.lastSeq;
    let caughtUp = false;
    this.readers += 1;
    try {
      // Capability and ordering are one stream: consumers must wait for the
      // matching replay-complete before interpreting historical turn results.
      await this.deliver(emit, { t: 'replay-start' }, signal);
      if (signal?.aborted) return;
      const file = await this.ready;
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
          const { bytesRead } = await file.read(
            buffer,
            0,
            Math.min(buffer.length, this.committedBytes - position),
            position,
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
            if (!isRunnerdExecEvent(event))
              throw new Error('invalid journal event');
            if (
              !caughtUp &&
              event.t === 'exit' &&
              (event.seq ?? 0) >= throughSeq &&
              !signal?.aborted
            ) {
              caughtUp = true;
              await this.deliver(
                emit,
                { t: 'replay-complete', throughSeq },
                signal,
              );
            }
            if ((event.seq ?? 0) > sinceSeq && !signal?.aborted)
              await this.deliver(emit, event, signal);
            if (
              !caughtUp &&
              (event.seq ?? 0) >= throughSeq &&
              !signal?.aborted
            ) {
              caughtUp = true;
              await this.deliver(
                emit,
                { t: 'replay-complete', throughSeq },
                signal,
              );
            }
          }
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
    if (!this.disposed || this.writing || this.readers > 0 || this.closed)
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
