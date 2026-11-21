'use node';

/**
 * Where an extractor that reads a file as a stream puts the text it makes,
 * as it makes it.
 *
 * An extractor that returns one string holds the whole text beside whatever
 * it read it from. One that writes to a sink holds a piece at a time, so a
 * spreadsheet of sixty thousand rows costs the reader its rows' worth of
 * state and not its text's (tale-project/tale#4942).
 */

import { open, type FileHandle } from 'node:fs/promises';

export interface TextSink {
  /** Add `text` after everything written so far. */
  write(text: string): Promise<void>;
  /** Forget everything written so far: a reader that finds, part-way, that
   * it cannot read the file its way starts the other way from nothing. */
  reset(): Promise<void>;
  /** UTF-16 units written since the last reset: the text's `length`. */
  readonly chars: number;
}

/** A sink that keeps the text in memory: for a caller that wants a string. */
export class MemoryTextSink implements TextSink {
  private parts: string[] = [];
  chars = 0;

  write(text: string): Promise<void> {
    this.parts.push(text);
    this.chars += text.length;
    return Promise.resolve();
  }

  reset(): Promise<void> {
    this.parts = [];
    this.chars = 0;
    return Promise.resolve();
  }

  text(): string {
    return this.parts.join('');
  }
}

/** How much text is gathered before it is handed to the file: enough that a
 * reader writing a row at a time makes few system calls. */
const FLUSH_CHARS = 64 * 1024;

/** How much text is encoded at a time, in UTF-16 units. */
const ENCODE_CHARS = 16 * 1024;

/** A unit encodes to three bytes at most. */
const BYTES_PER_CHAR = 3;

const isHighSurrogate = (unit: number): boolean =>
  unit >= 0xd800 && unit <= 0xdbff;

/** A character a string of one byte a character cannot hold. */
const WIDE = /[^\u0000-\u00ff]/;

/**
 * A reader wrote more text than its sink takes.
 *
 * A reader writes what the file says to write, and a file can say a great
 * deal in a few bytes: a sheet that states it is sixteen thousand columns
 * wide makes a line of fifty kilobytes of every row. The sink is where that
 * is stopped, before it fills the disk and long before anyone reads the
 * text back (tale-project/tale#4942).
 */
export class TextLimitError extends Error {
  constructor(readonly maxBytes: number) {
    super(`the text is longer than the ${maxBytes} bytes its reader may write`);
    this.name = 'TextLimitError';
  }
}

/** A sink that writes the text to a file, as UTF-8. */
export class FileTextSink implements TextSink {
  private pending: string[] = [];
  private pendingChars = 0;
  /** The write in flight, and those before it: a piece is handed to the
   * file only when the one before it has landed, so the pieces of two
   * callers that do not wait for each other still land in order. */
  private written: Promise<void> = Promise.resolve();
  /** The one buffer the text is encoded into on its way to the file. A
   * buffer for every write is as much again as the text, waiting to be
   * collected, in a process that is given little to read a file in. */
  private readonly encoded = Buffer.allocUnsafe(FLUSH_CHARS * BYTES_PER_CHAR);
  chars = 0;
  /** The bytes handed to the file since the last reset. */
  bytes = 0;
  /** Whether the text holds a character past U+00FF: in memory such a text
   * is two bytes a character, every character of it. */
  wide = false;
  /** Whether a write went past the limit: nothing is taken after it, or the
   * text would go on with a piece of it missing. */
  private full = false;

  private constructor(
    private readonly file: FileHandle,
    private readonly maxBytes: number | undefined,
  ) {}

  /**
   * Create the file (it must not exist). Opened for appending: every write
   * lands at the file's end, which a reset moves back to its start. With
   * `maxBytes`, the write that would take the file past that many bytes
   * fails with {@link TextLimitError}, and so does every write after it.
   */
  static async create(
    path: string,
    options: { maxBytes?: number } = {},
  ): Promise<FileTextSink> {
    return new FileTextSink(await open(path, 'ax', 0o600), options.maxBytes);
  }

  async write(text: string): Promise<void> {
    if (text === '') return;
    // A unit is a byte at least: text that is too long in units is too long
    // in bytes, and is refused before it is gathered.
    if (
      this.maxBytes !== undefined &&
      (this.full || this.chars + text.length > this.maxBytes)
    ) {
      this.full = true;
      throw new TextLimitError(this.maxBytes);
    }
    this.pending.push(text);
    this.pendingChars += text.length;
    this.chars += text.length;
    if (this.pendingChars >= FLUSH_CHARS) await this.flush();
  }

  async reset(): Promise<void> {
    this.pending = [];
    this.pendingChars = 0;
    this.chars = 0;
    this.written = this.written.then(async () => {
      await this.file.truncate(0);
      this.bytes = 0;
      this.wide = false;
      this.full = false;
    });
    await this.written;
  }

  /**
   * Hand what is gathered to the file. A character outside the basic plane
   * is two units, and UTF-8 has no way to write the first without the
   * second: a first half at the very end waits for the write that brings
   * its other half, unless this is the `last` write.
   */
  private flush(last = false): Promise<void> {
    if (this.pending.length === 0) return this.written;
    const parts = this.pending;
    let held = '';
    const final = parts.at(-1) ?? '';
    if (!last && isHighSurrogate(final.charCodeAt(final.length - 1))) {
      held = final.slice(-1);
      parts[parts.length - 1] = final.slice(0, -1);
    }
    this.pending = held === '' ? [] : [held];
    this.pendingChars = held.length;
    this.written = this.written.then(() => this.put(parts));
    return this.written;
  }

  /**
   * Encode `parts` as the UTF-8 of their text joined, and write it. The
   * text is neither joined nor encoded whole: a slice at a time goes into
   * the one buffer, which is written whenever it is full. A slice that ends
   * on the first half of a character leaves that half for the slice after
   * it, so the two are encoded as the one character they are.
   */
  private async put(parts: readonly string[]): Promise<void> {
    let filled = 0;
    let carried = '';
    for (const part of parts) {
      for (let from = 0; from < part.length; from += ENCODE_CHARS) {
        let slice = carried + part.slice(from, from + ENCODE_CHARS);
        carried = '';
        if (isHighSurrogate(slice.charCodeAt(slice.length - 1))) {
          carried = slice.slice(-1);
          slice = slice.slice(0, -1);
        }
        if (slice === '') continue;
        if (this.encoded.length - filled < slice.length * BYTES_PER_CHAR) {
          await this.send(filled);
          filled = 0;
        }
        const encoded = this.encoded.write(slice, filled, 'utf8');
        filled += encoded;
        this.bytes += encoded;
        if (this.maxBytes !== undefined && this.bytes > this.maxBytes) {
          this.full = true;
          throw new TextLimitError(this.maxBytes);
        }
        if (!this.wide && WIDE.test(slice)) this.wide = true;
      }
    }
    // A first half that nothing followed: it is written as what it is, a
    // character that cannot be.
    if (carried !== '') {
      if (this.encoded.length - filled < BYTES_PER_CHAR) {
        await this.send(filled);
        filled = 0;
      }
      const encoded = this.encoded.write(carried, filled, 'utf8');
      filled += encoded;
      this.bytes += encoded;
    }
    await this.send(filled);
  }

  /** Write the first `bytes` of the buffer at the end of the file. */
  private async send(bytes: number): Promise<void> {
    let sent = 0;
    while (sent < bytes) {
      const { bytesWritten } = await this.file.write(
        this.encoded,
        sent,
        bytes - sent,
      );
      sent += bytesWritten;
    }
  }

  /** Write what is still gathered and close the file. */
  async close(): Promise<void> {
    try {
      await this.flush(true);
    } finally {
      await this.file.close();
    }
  }
}
