// Bounded, disk-backed exec replay. The small in-memory ring remains the fast
// reconnect path; older output is streamed from here. A checkpoint is committed
// before acknowledged segments are removed, so handoffs need only newer bytes.
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

interface Segment {
  path: string;
  first: number;
  last: number;
  bytes: number;
}

export class ExecReplay {
  private readonly directory: Promise<string>;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly segments: Segment[] = [];
  private bytes = 0;
  private nextFile = 0;
  private checkpoint: RunnerdExecCheckpoint | null = null;
  private disposed = false;
  private failed = false;
  private writer: FileHandle | undefined;

  constructor(
    private readonly limits = {
      segmentBytes: SEGMENT_BYTES,
      maxBytes: REPLAY_BYTES,
    },
  ) {
    this.directory = mkdtemp(join(tmpdir(), 'tale-replay-'));
    // Observe a failed mkdir even before the first append joins its promise.
    void this.directory.catch(() => {
      // The first append reports the storage failure to its owning exec.
    });
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => {
      // The operation caller receives the error; later cleanup must still run.
    });
    return result;
  }

  append(line: string, seq: number): Promise<void> {
    return this.serial(async () => {
      if (this.disposed || this.failed) return;
      try {
        let segment = this.segments.at(-1);
        if (!segment || segment.bytes >= this.limits.segmentBytes) {
          segment = {
            path: join(await this.directory, `${this.nextFile++}.ndjson`),
            first: seq,
            last: seq,
            bytes: 0,
          };
          await this.writer?.close();
          this.writer = await open(segment.path, 'ax', 0o600);
          this.segments.push(segment);
        }
        if (!this.writer) throw new Error('replay_writer_missing');
        await this.writer.writeFile(line);
        const bytes = Buffer.byteLength(line);
        segment.bytes += bytes;
        segment.last = seq;
        this.bytes += bytes;
        await this.prune();
      } catch (error) {
        this.failed = true;
        throw error;
      }
    });
  }

  private async prune(): Promise<void> {
    while (this.segments.length > 1) {
      const first = this.segments[0];
      if (
        !first ||
        (this.bytes <= this.limits.maxBytes &&
          first.last > (this.checkpoint?.seq ?? -1))
      )
        break;
      await rm(first.path, { force: true });
      this.segments.shift();
      this.bytes -= first.bytes;
    }
  }

  async getCheckpoint(): Promise<RunnerdExecCheckpoint | null> {
    await this.queue;
    // Read committed bytes, never hand a caller a mutable reference to state.
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
      throw new Error('invalid_checkpoint');
    return { seq: value.seq, state: value.state };
  }

  saveCheckpoint(checkpoint: RunnerdExecCheckpoint): Promise<boolean> {
    return this.serial(async () => {
      if (this.disposed || this.failed) throw new Error('replay_unavailable');
      if (checkpoint.seq < (this.checkpoint?.seq ?? -1)) return false;
      const root = await this.directory;
      const temporary = join(root, 'checkpoint.tmp');
      const file = await open(temporary, 'w', 0o600);
      try {
        await file.writeFile(JSON.stringify(checkpoint));
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, join(root, 'checkpoint.json'));
      const directory = await open(root, 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
      this.checkpoint = checkpoint;
      await this.prune();
      return true;
    });
  }

  /** Open the entire bounded snapshot under the writer's queue. A checkpoint
   * may then unlink any of its segments without invalidating the reader's
   * handles. No routine ack/rotation race can masquerade as lost history. */
  async replay(
    since: number,
    until: number,
    line: (value: string) => Promise<void>,
    gap: (from: number, to: number) => void,
    signal?: AbortSignal,
  ): Promise<number> {
    if (signal?.aborted || since >= until) return since;
    const snapshot = await this.serial(async () => {
      const opened: Array<{
        first: number;
        last: number;
        bytes: number;
        file: FileHandle;
      }> = [];
      try {
        for (const segment of this.segments) {
          if (segment.last <= since || segment.first > until || signal?.aborted)
            continue;
          opened.push({
            first: segment.first,
            last: segment.last,
            bytes: segment.bytes,
            file: await open(segment.path, 'r'),
          });
        }
        return opened;
      } catch (error) {
        await Promise.all(opened.map((segment) => segment.file.close()));
        throw error;
      }
    });
    let cursor = since;
    try {
      for (const segment of snapshot) {
        if (signal?.aborted) return cursor;
        if (segment.first > cursor + 1) {
          gap(cursor + 1, segment.first - 1);
          return cursor;
        }
        const buffer = Buffer.alloc(64 * 1024);
        const decoder = new StringDecoder('utf8');
        let offset = 0;
        let pending = '';
        while (offset < segment.bytes) {
          if (signal?.aborted) return cursor;
          const { bytesRead } = await segment.file.read(
            buffer,
            0,
            Math.min(buffer.length, segment.bytes - offset),
            offset,
          );
          if (bytesRead === 0) break;
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
              throw new Error('invalid_replay_event');
            if (event.seq <= cursor) continue;
            if (event.seq > until || signal?.aborted) return cursor;
            if (event.seq !== cursor + 1) {
              gap(cursor + 1, event.seq - 1);
              return cursor;
            }
            await line(item);
            cursor = event.seq;
          }
        }
      }
      if (cursor < until && !signal?.aborted) gap(cursor + 1, until);
      return cursor;
    } finally {
      await Promise.all(snapshot.map((segment) => segment.file.close()));
    }
  }

  finish(): Promise<void> {
    return this.serial(async () => {
      await this.writer?.close();
      this.writer = undefined;
    });
  }

  dispose(): Promise<void> {
    return this.serial(async () => {
      this.disposed = true;
      await this.writer?.close();
      this.writer = undefined;
      await rm(await this.directory, { recursive: true, force: true });
      this.segments.length = 0;
      this.bytes = 0;
    });
  }
}
