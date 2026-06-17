'use node';

/**
 * Shared OOXML (zip) reading helpers for DOCX/PPTX extraction.
 *
 * Enforces a decompressed-size cap to guard against zip bombs, accumulating the
 * decompressed byte count across the parts that are actually read (JSZip does
 * not surface per-entry uncompressed sizes before extraction).
 */

import JSZip from 'jszip';

export const MAX_UNCOMPRESSED_SIZE = 500 * 1024 * 1024; // 500 MB

/** A zip reader that tracks cumulative decompressed bytes against a cap. */
export class GuardedZip {
  private decompressed = 0;

  private constructor(
    private readonly zip: JSZip,
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
    return new GuardedZip(zip, maxUncompressed);
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
    return Object.keys(this.zip.files);
  }

  /** Read an entry as a UTF-8 string, or null if absent. */
  async readString(path: string): Promise<string | null> {
    const file = this.zip.file(path);
    if (!file) {
      return null;
    }
    const text = await file.async('string');
    this.accrue(Buffer.byteLength(text, 'utf-8'));
    return text;
  }

  /** Read an entry as bytes, or null if absent. */
  async readBytes(path: string): Promise<Uint8Array | null> {
    const file = this.zip.file(path);
    if (!file) {
      return null;
    }
    const bytes = await file.async('uint8array');
    this.accrue(bytes.length);
    return bytes;
  }
}
