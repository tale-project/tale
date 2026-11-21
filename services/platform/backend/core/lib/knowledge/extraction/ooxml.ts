'use node';

/**
 * Shared OOXML (zip) reading helpers for DOCX/PPTX/ODT extraction.
 *
 * Enforces a decompressed-size cap to guard against zip bombs, accumulating the
 * decompressed byte count across the parts that are actually read.
 *
 * An archive is read through a backing. The one here holds the archive's
 * bytes in memory (`GuardedZip.load`); the one that reads an archive from
 * disk, a part at a time, is `file_extraction/zip_file.ts`. This module
 * opens no file: it is among the rules a data migration may reach
 * (`backend/db/data-migrations.test.ts`).
 */

import JSZip from 'jszip';

const MAX_UNCOMPRESSED_SIZE = 500 * 1024 * 1024; // 500 MB

/** One way of reading an archive's parts. */
export interface ZipBacking {
  names(): string[];
  /** The size the archive states for a part, before it is inflated; null
   * where the backing only knows once it has read the part. */
  statedSize(path: string): number | null;
  read(path: string): Promise<Uint8Array | null>;
  close(): void;
}

/** The whole archive in memory (JSZip does not surface per-entry
 * uncompressed sizes before extraction). */
class MemoryBacking implements ZipBacking {
  constructor(private readonly zip: JSZip) {}

  names(): string[] {
    return Object.keys(this.zip.files);
  }

  statedSize(): number | null {
    return null;
  }

  async read(path: string): Promise<Uint8Array | null> {
    const file = this.zip.file(path);
    return file ? await file.async('uint8array') : null;
  }

  close(): void {
    // Nothing is held open.
  }
}

/** A zip reader that tracks cumulative decompressed bytes against a cap. */
export class GuardedZip {
  private decompressed = 0;

  private constructor(
    private readonly backing: ZipBacking,
    private readonly maxUncompressed: number,
  ) {}

  static async load(
    bytes: Uint8Array,
    maxUncompressed = MAX_UNCOMPRESSED_SIZE,
  ): Promise<GuardedZip> {
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(bytes);
    } catch (err) {
      throw new Error('Invalid or corrupt file', { cause: err });
    }
    return new GuardedZip(new MemoryBacking(zip), maxUncompressed);
  }

  /** A reader over another way of reading an archive's parts. */
  static over(
    backing: ZipBacking,
    maxUncompressed = MAX_UNCOMPRESSED_SIZE,
  ): GuardedZip {
    return new GuardedZip(backing, maxUncompressed);
  }

  private accrue(byteLength: number): void {
    this.decompressed += byteLength;
    if (this.decompressed > this.maxUncompressed) {
      throw new Error(
        `File exceeds maximum decompressed size (${this.decompressed} bytes)`,
      );
    }
  }

  /** Names of all entries in the archive. */
  names(): string[] {
    return this.backing.names();
  }

  /** Read an entry as a UTF-8 string, or null if absent. */
  async readString(path: string): Promise<string | null> {
    const bytes = await this.readBytes(path);
    return bytes === null ? null : Buffer.from(bytes).toString('utf8');
  }

  /** Read an entry as bytes, or null if absent. */
  async readBytes(path: string): Promise<Uint8Array | null> {
    // A part that states a size over the cap is refused before a byte of it
    // is inflated; one that states none is counted once it is read.
    const stated = this.backing.statedSize(path);
    if (stated !== null && this.decompressed + stated > this.maxUncompressed) {
      this.accrue(stated);
    }
    const bytes = await this.backing.read(path);
    if (bytes === null) {
      return null;
    }
    this.accrue(bytes.length);
    return bytes;
  }

  /** Let go of the archive: one on disk is closed. */
  close(): void {
    this.backing.close();
  }
}
