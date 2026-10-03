// Bounded workspace-backed exec output. The writer's caller pauses the child's
// pipes until append settles; neither disk latency nor a disconnected reader
// may build an unbounded in-memory queue. The ordinary ring is still the fast
// path for recent cursors, and a missing journal is always an explicit gap.
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, rm, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';

export const EXEC_JOURNAL_MAX_BYTES = 64 * 1024 * 1024;
export const RECENT_JOURNAL_MAX_BYTES = 64 * 1024 * 1024;

export class ExecOutput {
  private readonly path: string;
  private file: FileHandle | null = null;
  private identity: { dev: number; ino: number } | null = null;
  private pending: Promise<void>;
  private broken = false;
  private reserved = 0;
  private committed = 0;
  private lastSeq = 0;
  private ended = false;

  constructor(
    root: string,
    private readonly maxBytes = EXEC_JOURNAL_MAX_BYTES,
  ) {
    const directory = join(root, '.runtime/tmp/runnerd-output');
    this.path = join(directory, `${randomUUID()}.jsonl`);
    this.pending = mkdir(directory, { recursive: true })
      .then(async () => {
        this.file = await open(this.path, 'wx', 0o600);
        const stat = await this.file.stat();
        this.identity = { dev: stat.dev, ino: stat.ino };
        return undefined;
      })
      .catch(() => {
        this.broken = true;
      });
  }

  get bytes(): number {
    return this.reserved;
  }

  append(line: string, seq: number): Promise<void> {
    if (this.broken || this.ended) return Promise.resolve();
    const bytes = Buffer.byteLength(line);
    if (this.reserved + bytes > this.maxBytes) {
      this.broken = true;
      return this.pending;
    }
    this.reserved += bytes;
    this.pending = this.pending
      .then(async () => {
        if (this.file === null) return undefined;
        await this.file.writeFile(line);
        this.committed += bytes;
        this.lastSeq = seq;
        return undefined;
      })
      .catch(() => {
        this.broken = true;
      });
    return this.pending;
  }

  async close(): Promise<void> {
    this.ended = true;
    await this.pending;
    const file = this.file;
    this.file = null;
    await file?.close().catch(() => {
      this.broken = true;
    });
  }

  async dispose(): Promise<void> {
    this.broken = true;
    await this.close();
    await rm(this.path, { force: true }).catch(() => {});
  }

  /** Read only committed bytes. A caller may replay while new events append;
   * it catches up again before synchronously joining the live subscribers. */
  async replay(
    throughSeq: number,
    emit: (line: string) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<boolean> {
    await this.pending;
    if (signal?.aborted) return true;
    if (this.broken || this.lastSeq < throughSeq) return false;
    let file: FileHandle;
    try {
      file = await open(
        this.path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
    } catch {
      return false;
    }
    const committed = this.committed;
    try {
      const stat = await file.stat();
      const identity = this.identity;
      if (
        !stat.isFile() ||
        identity === null ||
        stat.dev !== identity.dev ||
        stat.ino !== identity.ino ||
        stat.size < committed
      ) {
        await file.close();
        return false;
      }
    } catch {
      await file.close().catch(() => {});
      return false;
    }
    const input = file.createReadStream({
      end: committed - 1,
      encoding: 'utf8',
      highWaterMark: 64 * 1024,
      autoClose: true,
    });
    const abort = () => input.destroy();
    signal?.addEventListener('abort', abort, { once: true });
    let residual = '';
    try {
      // Iterate the readable itself, whose highWaterMark stops disk reads
      // while emit awaits HTTP drain. readline's line-event iterator may
      // prefetch the whole journal into its event queue during that wait.
      for await (const chunk of input) {
        if (signal?.aborted) break;
        residual += String(chunk);
        let newline = residual.indexOf('\n');
        while (newline >= 0) {
          if (signal?.aborted) return true;
          const line = residual.slice(0, newline);
          if (line.length > 1_048_576) return false;
          residual = residual.slice(newline + 1);
          await emit(line);
          newline = residual.indexOf('\n');
        }
        // Same ceiling as the spawner's NDJSON residual guard. A damaged
        // journal must not grow memory just because it lost its newlines.
        if (residual.length > 1_048_576) return false;
      }
      return (
        !this.broken && (signal?.aborted === true || residual.length === 0)
      );
    } catch {
      return signal?.aborted === true;
    } finally {
      signal?.removeEventListener('abort', abort);
      input.destroy();
      await file.close().catch(() => {});
    }
  }
}
